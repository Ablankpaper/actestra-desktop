import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  ACTESTRA_TEAM_LOCAL_USER_ID,
  assertAionUiTeamBridgeResponse,
  assertNativeAionUiTeam,
  assertNativeAionUiTeamRunEvent,
  assertNativeAionUiStandardTeam,
  assertNativeAionUiStandardTeamRunEvent,
  projectArtifactDelivery,
  type AionUiTeamBridgeRoute,
  type AionUiTeamBridgeSuccessData,
  type AionUiTeamEvent,
  type AionUiTeamMemberInput,
  type AionUiStandardTeamMemberIntent,
  type NativeAionUiStandardTeam,
  type NativeAionUiStandardTeamAssistant,
  type NativeAionUiStandardTeamMemberAck,
  type NativeAionUiStandardTeamRunAck,
  type NativeAionUiStandardTeamRunEvent,
  type NativeAionUiStandardTeamRunState,
  type NativeAionUiTeam,
  type NativeAionUiTeamActivity,
  type NativeAionUiTeamArtifactDelivery,
  type NativeAionUiTeamArtifactReference,
  type NativeAionUiTeamAssistant,
  type NativeAionUiTeamConfigOptions,
  type NativeAionUiTeamModelOptions,
  type NativeAionUiTeamModelSelection,
  type NativeAionUiTeamNodeView,
  type NativeAionUiTeamRunAck,
  type NativeAionUiTeamRunEvent,
  type NativeAionUiTeamRunState,
  type NativeAionUiTeamSlotWork,
  type NativeAionUiTeamWorkspaceOption,
  type NativeAionUiTeamWorkspaceOptions,
} from "../../compatibility/aionui";
import {
  PersistenceError,
  DEFAULT_GENERAL_REQUIREMENTS,
  artifactId,
  assertDomainGraph,
  compareInstants,
  correlationId,
  instant,
  normalizeAdmittedTeamPlan,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
  normalizeStandardTeamMessageDelivery,
  sessionId,
  taskId,
  teamId,
  teamExperienceId,
  teamMemberId,
  teamRunId,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  type ActestraPersistencePort,
  type AdmittedTeamPlan,
  type Instant,
  type TeamDefinition,
  type TeamMember,
  type TeamModelSelection,
  type TeamPlanNodeId,
  type TeamRunNode,
  type TeamRunSnapshot,
} from "../../core";
import { AionUiTeamBridgePortError, type AionUiTeamBridgePort } from "./aionuiTeamBridgeService";
import {
  TeamOrchestratorServiceError,
  type CancelTeamRunInput,
  type CreateTeamRunInput,
  type CompleteTeamHandoffInput,
  type DecideTeamNodeApprovalInput,
  type ResolveTeamFeedbackInput,
  type TeamNodeControlInput,
} from "../orchestration/teamOrchestratorService";
import { withPersistenceMutationBarrier } from "../persistence/persistenceMutationBarrier";
import {
  deriveTeamJourneyBinding,
  deriveTeamJourneyReplyStreamId,
} from "../orchestration/teamJourneyWorkerRouter";
import { TeamPlanAdmissionServiceError } from "../orchestration/teamPlanAdmissionService";

export interface AionUiTeamPersistencePort extends Pick<
  ActestraPersistencePort,
  | "persistTeamDefinition"
  | "persistTeamExperienceBinding"
  | "loadDomainGraph"
  | "replaceDomainGraph"
  | "storeContentReference"
  | "persistWorkspaceGrant"
  | "getActiveWorkspaceGrant"
  | "getTeamDefinition"
  | "getTeamExperienceBinding"
  | "persistStandardTeamMessageDelivery"
  | "getStandardTeamMessageDelivery"
  | "listUnresolvedStandardTeamMessageDeliveries"
  | "listTeamDefinitions"
  | "replaceTeamDefinition"
  | "removeTeamDefinition"
  | "getAdmittedTeamPlan"
  | "listTeamRunsForTeam"
  | "listArtifactDeliveriesForTask"
  | "replayEvents"
> {}

export interface AionUiTeamAdmissionPort {
  propose(request: unknown, signal?: AbortSignal): Promise<AdmittedTeamPlan>;
}

export interface AionUiTeamWorkspaceSelectionPort {
  select(): Promise<Readonly<{ rootPath: string; displayName: string }> | null>;
}

export type AionUiPreparedStandardTeamMessageEffect = () => Promise<NativeAionUiStandardTeamRunAck>;

export interface AionUiTeamOrchestratorPort {
  create(input: CreateTeamRunInput): Promise<TeamRunSnapshot>;
  start(runId: ReturnType<typeof teamRunId>, occurredAt: Instant): Promise<TeamRunSnapshot>;
  get(runId: ReturnType<typeof teamRunId>): Promise<TeamRunSnapshot>;
  subscribe(handler: (snapshot: TeamRunSnapshot) => void): () => void;
  resolveFeedback(input: ResolveTeamFeedbackInput): Promise<TeamRunSnapshot>;
  pause(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  resume(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  decideApproval(input: DecideTeamNodeApprovalInput): Promise<TeamRunSnapshot>;
  retry(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  replace(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  requestHandoff(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  completeHandoff(input: CompleteTeamHandoffInput): Promise<TeamRunSnapshot>;
  requestRevision(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  cancelNode(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  cancelRun(input: CancelTeamRunInput): Promise<TeamRunSnapshot>;
}

export interface AionUiTeamWorkerRuntimeAdmissionPort {
  admit(team: TeamDefinition): Promise<AionUiTeamOrchestratorPort | null>;
}

export interface AionUiTeamModelCatalogPort {
  list(): Promise<NativeAionUiTeamModelOptions>;
}

export interface AionUiTeamServiceOptions {
  readonly persistence: AionUiTeamPersistencePort;
  readonly admission: AionUiTeamAdmissionPort | null;
  readonly orchestrator: AionUiTeamOrchestratorPort | null;
  readonly workerRuntimeAdmission?: AionUiTeamWorkerRuntimeAdmissionPort | null;
  readonly modelCatalog?: AionUiTeamModelCatalogPort | null;
  readonly workspaceSelection?: AionUiTeamWorkspaceSelectionPort | null;
  readonly standardTeamCreation?: AionUiStandardTeamCreationPort | null;
  readonly now: () => Instant;
  readonly createDigest: () => string;
}

export interface AionUiStandardTeamCreationPort {
  list(): Promise<readonly NativeAionUiStandardTeam[]>;
  get(teamId: string): Promise<NativeAionUiStandardTeam>;
  create(
    intent: Extract<AionUiTeamBridgeRoute, { kind: "create-standard" }>,
  ): Promise<NativeAionUiStandardTeam>;
  addMember(
    intent: Extract<AionUiTeamBridgeRoute, { kind: "add-standard-member" }>,
  ): Promise<NativeAionUiStandardTeamMemberAck>;
  loadConfigOptions(teamId: string, conversationId: string): Promise<NativeAionUiTeamConfigOptions>;
  setConfigOption(
    teamId: string,
    conversationId: string,
    optionId: string,
    value: string,
  ): Promise<NativeAionUiTeamConfigOptions>;
  setSessionMode(
    teamId: string,
    conversationId: string,
    mode: string,
  ): Promise<NativeAionUiStandardTeam>;
  ensureSession(teamId: string): Promise<NativeAionUiStandardTeam>;
  stopSession(teamId: string): Promise<NativeAionUiStandardTeamRunState>;
  renewActiveLease(teamId: string): Promise<void>;
  rename(teamId: string, name: string): Promise<NativeAionUiStandardTeam>;
  remove(teamId: string): Promise<void>;
  renameMember(teamId: string, slotId: string, name: string): Promise<NativeAionUiStandardTeam>;
  removeMember(teamId: string, slotId: string): Promise<void>;
  sendMessage(
    teamId: string,
    content: string,
    files: readonly string[],
  ): Promise<NativeAionUiStandardTeamRunAck>;
  prepareMessageEffect(
    teamId: string,
    content: string,
    files: readonly string[],
  ): Promise<AionUiPreparedStandardTeamMessageEffect>;
  sendMemberMessage(
    teamId: string,
    slotId: string,
    content: string,
    files: readonly string[],
  ): Promise<NativeAionUiStandardTeamRunAck>;
  prepareMemberMessageEffect(
    teamId: string,
    slotId: string,
    content: string,
    files: readonly string[],
  ): Promise<AionUiPreparedStandardTeamMessageEffect>;
  getRunState(teamId: string): Promise<NativeAionUiStandardTeamRunState>;
  pauseMemberWork(
    teamId: string,
    runId: string,
    slotId: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState>;
  cancelMemberWork(
    teamId: string,
    runId: string,
    slotId: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState>;
  cancelRun(
    teamId: string,
    runId: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState>;
  attachMember(teamId: string, slotId: string): Promise<NativeAionUiStandardTeam>;
}

export interface AionUiStandardTeamBackendPort {
  getAssistant(assistantId: string): Promise<unknown>;
  listManagedAgents(): Promise<unknown>;
  discoverAssistantModelCatalog?(assistantId: string): Promise<unknown>;
  listTeams(): Promise<unknown>;
  getTeam(teamId: string): Promise<unknown>;
  createTeam(body: unknown): Promise<unknown>;
  renameTeam?(teamId: string, name: string): Promise<unknown>;
  removeTeam(teamId: string): Promise<unknown>;
  addTeamMember?(teamId: string, body: unknown): Promise<unknown>;
  renameTeamMember?(teamId: string, slotId: string, name: string): Promise<unknown>;
  removeTeamMember?(teamId: string, slotId: string): Promise<unknown>;
  setTeamSessionMode?(teamId: string, mode: string): Promise<unknown>;
  ensureTeamSession?(teamId: string): Promise<unknown>;
  stopTeamSession?(teamId: string): Promise<unknown>;
  renewTeamActiveLease?(teamId: string): Promise<unknown>;
  sendTeamMessage?(teamId: string, body: unknown): Promise<unknown>;
  sendTeamMemberMessage?(teamId: string, slotId: string, body: unknown): Promise<unknown>;
  getTeamRunState?(teamId: string): Promise<unknown>;
  pauseTeamMemberWork?(
    teamId: string,
    runId: string,
    slotId: string,
    body: unknown,
  ): Promise<unknown>;
  cancelTeamMemberWork?(
    teamId: string,
    runId: string,
    slotId: string,
    body: unknown,
  ): Promise<unknown>;
  cancelTeamRun?(teamId: string, runId: string, body: unknown): Promise<unknown>;
  attachTeamMember?(teamId: string, slotId: string): Promise<unknown>;
  reconcileConfigOptions?(
    teamId: string,
    conversationId: string,
  ): Promise<NativeAionUiTeamConfigOptions>;
  setConfigOption?(
    teamId: string,
    conversationId: string,
    optionId: string,
    value: string,
  ): Promise<NativeAionUiTeamConfigOptions>;
}

export interface AionUiStandardTeamCreationServiceOptions {
  readonly backend: AionUiStandardTeamBackendPort;
}

export interface AionUiStandardTeamProbeProcessGuardPort {
  capture(conversationId: string): Promise<AionCoreProbeProcessSnapshot>;
  cleanup(snapshot: AionCoreProbeProcessSnapshot): Promise<void>;
}

export interface LoopbackAionUiStandardTeamBackendOptions {
  readonly probeProcessGuard: AionUiStandardTeamProbeProcessGuardPort;
}

type TeamControlKind = Extract<
  AionUiTeamBridgeRoute,
  {
    kind:
      | "cancel-node"
      | "pause-node"
      | "resume-node"
      | "retry-node"
      | "replace-node"
      | "handoff-node"
      | "revise-node";
  }
>["kind"];

const TERMINAL_RUN_STATUSES = new Set<TeamRunSnapshot["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const STANDARD_TEAM_BACKEND_TIMEOUT_MS = 10_000;
const STANDARD_TEAM_RUNTIME_DISCOVERY_TIMEOUT_MS = 45_000;
const MAX_TEAM_ACTIVITY_CONTENT_BYTES = 8 * 1024;
const MAX_STANDARD_TEAM_BACKEND_BODY_BYTES = 64 * 1024;
const AIONCORE_AGENT_PROCESS_REGISTRY_RELATIVE_PATH = path.join(
  "runtime",
  "agent-process-registry.json",
);
const MAX_AIONCORE_AGENT_PROCESS_REGISTRY_BYTES = 64 * 1024;
const MAX_AIONCORE_AGENT_PROCESS_REGISTRY_ENTRIES = 128;
const MAX_AIONCORE_PROBE_PROCESS_ENTRIES = 8;
const MAX_AIONCORE_PROBE_PROCESS_GROUP_MEMBERS = 64;
const MAX_AIONCORE_PROCESS_TABLE_BYTES = 256 * 1024;
const DEFAULT_AIONCORE_PROBE_TERMINATION_GRACE_MS = 1_000;
// How long a process-table read may take, which is unrelated to how long a probe
// process is given to exit: `ps` needs tens of milliseconds to walk a full table
// even when idle, so deriving this from the caller's cleanup grace starves the
// read on a loaded machine and reports a live probe as unreadable.
const AIONCORE_PROCESS_TABLE_READ_TIMEOUT_MS = 5_000;
const TEAM_MODEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u;

/** Per-task bound on the delivery read behind a Team Artifact, so a long history cannot stall it. */
const TEAM_ARTIFACT_DELIVERY_SCAN_LIMIT = 100;
const MAX_TEAM_MODEL_PROVIDERS = 64;
const MAX_TEAM_MODELS_PER_PROVIDER = 256;
const AIONUI_FILE_REFERENCE_MARKER = "[[AION_FILES]]";
const EXPLICIT_FILE_GENERAL_REQUIREMENTS = Object.freeze({
  contractVersion: 1 as const,
  capabilities: Object.freeze(["workspace-read"] as const),
  contextReferences: Object.freeze(["workspace-file"] as const),
  inputRequirements: Object.freeze(["file-reference"] as const),
  completionCriteria: "json-envelope" as const,
});
const EXPLICIT_NETWORK_GENERAL_REQUIREMENTS = Object.freeze({
  contractVersion: 1 as const,
  capabilities: Object.freeze(["network-fetch"] as const),
  contextReferences: Object.freeze(["network-resource"] as const),
  inputRequirements: Object.freeze(["network-reference"] as const),
  completionCriteria: "json-envelope" as const,
});

// This parser can only reduce authority: an explicit positive file/network instruction becomes a
// structured requirement that General v1 rejects before model execution. It never grants a tool or
// treats a negated clause such as "不要读取文件" / "do not read files" as a capability request.
const EXPLICIT_FILE_ACCESS_INSTRUCTION =
  /(?:^|[\n。！？；;:：])\s*(?:(?:请|先|请先)\s*)?(?:读取|打开|查看|浏览)\s*(?:(?:本地|当前|项目|仓库|工作区)\s*)?(?:文件|目录|README(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,16}|[./\\][^\s，。！？；;]+)/iu;
const EXPLICIT_ENGLISH_FILE_ACCESS_INSTRUCTION =
  /(?:^|[\n.!?;:])\s*(?:please\s+|first\s+|then\s+)*(?:read|open|inspect|browse)\s+(?:the\s+)?(?:local\s+|current\s+|project\s+|repository\s+|workspace\s+)*(?:file|directory|README(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,16}|[./\\][^\s,.!?;]+)/iu;
const EXPLICIT_NETWORK_ACCESS_INSTRUCTION =
  /(?:^|[\n。！？；;:：])\s*(?:(?:请|先|请先)\s*)?(?:联网|访问|检索|搜索|打开)\s*(?:网络|网页|网站|https?:\/\/)/iu;
const EXPLICIT_ENGLISH_NETWORK_ACCESS_INSTRUCTION =
  /(?:^|[\n.!?;:])\s*(?:please\s+|first\s+|then\s+)*(?:fetch|visit|search|browse|open)\s+(?:the\s+)?(?:web|network|website|https?:\/\/)/iu;

function generalRequirementsForTask(content: string, files: readonly string[]) {
  if (
    files.length > 0 ||
    EXPLICIT_FILE_ACCESS_INSTRUCTION.test(content) ||
    EXPLICIT_ENGLISH_FILE_ACCESS_INSTRUCTION.test(content)
  ) {
    return EXPLICIT_FILE_GENERAL_REQUIREMENTS;
  }
  if (
    EXPLICIT_NETWORK_ACCESS_INSTRUCTION.test(content) ||
    EXPLICIT_ENGLISH_NETWORK_ACCESS_INSTRUCTION.test(content)
  ) {
    return EXPLICIT_NETWORK_GENERAL_REQUIREMENTS;
  }
  return DEFAULT_GENERAL_REQUIREMENTS;
}

function orchestratedTaskGoal(content: string, files: readonly string[]): string {
  if (files.length === 0) return content;
  const marker = `\n\n${AIONUI_FILE_REFERENCE_MARKER}\n`;
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex < 0) return content;
  const instruction = content.slice(0, markerIndex).trim();
  return instruction.length === 0 ? "Review the explicitly selected files." : instruction;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotTeamModelOptions(value: unknown): NativeAionUiTeamModelOptions | null {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 1 ||
    !Object.hasOwn(value, "providers") ||
    !Array.isArray(value.providers) ||
    value.providers.length > MAX_TEAM_MODEL_PROVIDERS
  ) {
    return null;
  }
  const providerIds = new Set<string>();
  const providers: NativeAionUiTeamModelOptions["providers"][number][] = [];
  for (const candidate of value.providers) {
    if (
      !isRecord(candidate) ||
      Reflect.ownKeys(candidate).length !== 3 ||
      !Object.hasOwn(candidate, "provider_id") ||
      !Object.hasOwn(candidate, "name") ||
      !Object.hasOwn(candidate, "model_ids") ||
      typeof candidate.provider_id !== "string" ||
      candidate.provider_id.length > 256 ||
      !TEAM_MODEL_IDENTIFIER_PATTERN.test(candidate.provider_id) ||
      providerIds.has(candidate.provider_id) ||
      typeof candidate.name !== "string" ||
      candidate.name.length < 1 ||
      candidate.name.length > 256 ||
      candidate.name.trim() !== candidate.name ||
      !Array.isArray(candidate.model_ids) ||
      candidate.model_ids.length < 1 ||
      candidate.model_ids.length > MAX_TEAM_MODELS_PER_PROVIDER
    ) {
      return null;
    }
    const modelIds = new Set<string>();
    for (const modelId of candidate.model_ids) {
      if (
        typeof modelId !== "string" ||
        modelId.length > 256 ||
        !TEAM_MODEL_IDENTIFIER_PATTERN.test(modelId) ||
        modelIds.has(modelId)
      ) {
        return null;
      }
      modelIds.add(modelId);
    }
    providerIds.add(candidate.provider_id);
    providers.push(
      Object.freeze({
        provider_id: candidate.provider_id,
        name: candidate.name,
        model_ids: Object.freeze([...modelIds]),
      }),
    );
  }
  return Object.freeze({ providers: Object.freeze(providers) });
}

function safeProcessIdentity(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 1 ? (value as number) : null;
}

function processSignalFailed(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ESRCH";
}

function processSignalDenied(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EPERM";
}

function boundedDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface AionCoreProbeOwnedProcess {
  readonly pid: number;
  readonly processGroupId: number;
  readonly members: readonly AionCoreProbeProcessIdentity[];
}

export interface AionCoreProbeProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly userId: number;
  readonly startedAt: string;
  readonly executable: string;
}

export interface AionCoreProbeProcessSnapshot {
  readonly conversationId: string;
  readonly processes: readonly AionCoreProbeOwnedProcess[];
}

export interface AionCoreProbeProcessGuardOptions {
  readonly dataDirectory: string;
  readonly terminationGraceMs?: number;
}

interface AionCoreLiveProbeProcess {
  readonly process: AionCoreProbeOwnedProcess;
  readonly members: readonly AionCoreProbeProcessIdentity[];
}

export class AionCoreProbeProcessGuard implements AionUiStandardTeamProbeProcessGuardPort {
  readonly #registryPath: string;
  readonly #terminationGraceMs: number;
  readonly #ownedSnapshots = new WeakSet<object>();

  constructor(options: AionCoreProbeProcessGuardOptions) {
    if (
      !path.isAbsolute(options.dataDirectory) ||
      options.dataDirectory === path.parse(options.dataDirectory).root
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore process registry directory is invalid",
      );
    }
    const terminationGraceMs =
      options.terminationGraceMs ?? DEFAULT_AIONCORE_PROBE_TERMINATION_GRACE_MS;
    if (
      !Number.isSafeInteger(terminationGraceMs) ||
      terminationGraceMs < 10 ||
      terminationGraceMs > 5_000
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore process cleanup bound is invalid",
      );
    }
    this.#registryPath = path.join(
      options.dataDirectory,
      AIONCORE_AGENT_PROCESS_REGISTRY_RELATIVE_PATH,
    );
    this.#terminationGraceMs = terminationGraceMs;
  }

  async capture(conversationIdentity: string): Promise<AionCoreProbeProcessSnapshot> {
    const conversationId = standardText(
      conversationIdentity,
      "Temporary Team model catalog conversation identity",
    );
    if (process.platform === "win32") {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Stable Windows process identity is unavailable for temporary Team model cleanup",
      );
    }
    const registry = await this.#readRegistry();
    const processTable = await this.#readProcessTable();
    const processes: AionCoreProbeOwnedProcess[] = [];
    const seen = new Set<string>();
    for (const candidate of registry) {
      if (!isRecord(candidate) || candidate.conversation_id !== conversationId) continue;
      const pid = safeProcessIdentity(candidate.pid);
      const processGroupId = safeProcessIdentity(candidate.process_group_id);
      if (pid === null || processGroupId !== pid || pid === process.pid) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The temporary Team model catalog process ownership is invalid",
        );
      }
      const key = `${pid}:${processGroupId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const members = this.#captureOwnedProcessGroupMembers(processTable, processGroupId);
      processes.push(Object.freeze({ pid, processGroupId, members }));
      if (processes.length > MAX_AIONCORE_PROBE_PROCESS_ENTRIES) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The temporary Team model catalog process ownership exceeded its bound",
        );
      }
    }
    const snapshot = Object.freeze({
      conversationId,
      processes: Object.freeze(processes),
    });
    this.#ownedSnapshots.add(snapshot);
    return snapshot;
  }

  async cleanup(snapshot: AionCoreProbeProcessSnapshot): Promise<void> {
    if (!isRecord(snapshot) || !this.#ownedSnapshots.has(snapshot)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog process snapshot is invalid",
      );
    }
    const processes = snapshot.processes;
    if (processes.length === 0) {
      this.#ownedSnapshots.delete(snapshot);
      return;
    }
    try {
      let survivors = await this.#liveOwnedProcesses(processes);
      await Promise.all(survivors.map((entry) => this.#terminate(entry, false)));
      await this.#waitForExit(processes, this.#terminationGraceMs);
      survivors = await this.#liveOwnedProcesses(processes);
      await Promise.all(survivors.map((entry) => this.#terminate(entry, true)));
      await this.#waitForExit(
        survivors.map(({ process: entry }) => entry),
        this.#terminationGraceMs,
      );
      if ((await this.#liveOwnedProcesses(processes)).length > 0) {
        throw new Error("AionCore probe process group survived forced termination");
      }
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog process group could not be terminated",
      );
    }
    this.#ownedSnapshots.delete(snapshot);
  }

  async #readRegistry(): Promise<readonly unknown[]> {
    let source: string | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- atomic registry replacement can briefly expose ENOENT.
        source = await readFile(this.#registryPath, "utf8");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (attempt < 2) {
          // eslint-disable-next-line no-await-in-loop -- this is a bounded ownership snapshot retry.
          await boundedDelay(10);
        }
      }
    }
    if (source === null) return Object.freeze([]);
    if (Buffer.byteLength(source, "utf8") > MAX_AIONCORE_AGENT_PROCESS_REGISTRY_BYTES) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore process registry exceeded the size limit",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore process registry is invalid",
      );
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.processes) ||
      parsed.processes.length > MAX_AIONCORE_AGENT_PROCESS_REGISTRY_ENTRIES
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore process registry contract is invalid",
      );
    }
    return parsed.processes;
  }

  #readProcessTable(): Promise<readonly AionCoreProbeProcessIdentity[]> {
    const executablePath = process.platform === "linux" ? "/usr/bin/ps" : "/bin/ps";
    return new Promise((resolve, reject) => {
      execFile(
        executablePath,
        ["-axo", "pid=,pgid=,uid=,lstart=,comm="],
        {
          encoding: "utf8",
          env: { LANG: "C", LC_ALL: "C" },
          maxBuffer: MAX_AIONCORE_PROCESS_TABLE_BYTES,
          timeout: AIONCORE_PROCESS_TABLE_READ_TIMEOUT_MS,
        },
        (error, stdout) => {
          if (error !== null) {
            const failure = error as NodeJS.ErrnoException & {
              signal?: string | null;
            };
            const cause =
              failure.signal === "SIGTERM"
                ? "timeout"
                : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                  ? "output-limit"
                  : (failure.code ?? "spawn-failed");
            reject(
              new AionUiTeamBridgePortError(
                "team-model-unavailable",
                `The temporary Team model catalog process table could not be read (cause=${cause})`,
              ),
            );
            return;
          }
          const entries: AionCoreProbeProcessIdentity[] = [];
          for (const line of stdout.split("\n")) {
            const source = line.trim();
            if (source.length === 0) continue;
            const fields =
              /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/u.exec(
                source,
              );
            if (fields === null) {
              reject(
                new AionUiTeamBridgePortError(
                  "team-model-unavailable",
                  "The temporary Team model catalog process table is invalid",
                ),
              );
              return;
            }
            const pid = Number(fields[1]);
            const processGroupId = Number(fields[2]);
            const userId = Number(fields[3]);
            const startedAt = `${fields[4]} ${fields[5]} ${fields[6]} ${fields[7]} ${fields[8]}`;
            const executable = fields[9]!.trim();
            if (
              !Number.isSafeInteger(pid) ||
              pid < 1 ||
              !Number.isSafeInteger(processGroupId) ||
              processGroupId < 1 ||
              !Number.isSafeInteger(userId) ||
              userId < 0 ||
              executable.length === 0
            ) {
              reject(
                new AionUiTeamBridgePortError(
                  "team-model-unavailable",
                  "The temporary Team model catalog process table is invalid",
                ),
              );
              return;
            }
            entries.push(
              Object.freeze({
                pid,
                processGroupId,
                userId,
                startedAt,
                executable,
              }),
            );
          }
          resolve(Object.freeze(entries));
        },
      );
    });
  }

  #captureOwnedProcessGroupMembers(
    processTable: readonly AionCoreProbeProcessIdentity[],
    processGroupId: number,
  ): readonly AionCoreProbeProcessIdentity[] {
    const currentUserId = process.getuid?.();
    if (currentUserId === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog process owner is unavailable",
      );
    }
    const members = processTable.filter((entry) => entry.processGroupId === processGroupId);
    if (members.some((entry) => entry.userId !== currentUserId || entry.pid === process.pid)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog process group ownership is invalid",
      );
    }
    if (members.length > MAX_AIONCORE_PROBE_PROCESS_GROUP_MEMBERS) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog process group exceeded its member bound",
      );
    }
    return Object.freeze([...members].sort((left, right) => left.pid - right.pid));
  }

  async #liveOwnedProcesses(
    processes: readonly AionCoreProbeOwnedProcess[],
  ): Promise<readonly AionCoreLiveProbeProcess[]> {
    const processTable = await this.#readProcessTable();
    return Object.freeze(
      processes.flatMap((entry) => {
        const currentMembers = processTable.filter(
          ({ processGroupId }) => processGroupId === entry.processGroupId,
        );
        if (currentMembers.length === 0) return [];
        if (currentMembers.length > MAX_AIONCORE_PROBE_PROCESS_GROUP_MEMBERS) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The temporary Team model catalog process group exceeded its member bound",
          );
        }
        const capturedMembers = new Map(entry.members.map((member) => [member.pid, member]));
        const identityChanged = currentMembers.some((member) => {
          const captured = capturedMembers.get(member.pid);
          return (
            captured === undefined ||
            captured.processGroupId !== member.processGroupId ||
            captured.userId !== member.userId ||
            captured.startedAt !== member.startedAt ||
            captured.executable !== member.executable
          );
        });
        if (identityChanged) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The temporary Team model catalog process identity changed before cleanup",
          );
        }
        return [
          Object.freeze({
            process: entry,
            members: Object.freeze(currentMembers),
          }),
        ];
      }),
    );
  }

  async #terminate(entry: AionCoreLiveProbeProcess, force: boolean): Promise<void> {
    const refreshedBeforeGroupSignal = (await this.#liveOwnedProcesses([entry.process]))[0];
    if (refreshedBeforeGroupSignal === undefined) return;
    try {
      process.kill(
        -refreshedBeforeGroupSignal.process.processGroupId,
        force ? "SIGKILL" : "SIGTERM",
      );
    } catch (error) {
      if (processSignalFailed(error)) return;
      if (!processSignalDenied(error)) throw error;
      for (const capturedMember of refreshedBeforeGroupSignal.members) {
        const refreshedBeforeMemberSignal = (await this.#liveOwnedProcesses([entry.process]))[0];
        if (refreshedBeforeMemberSignal === undefined) return;
        const member = refreshedBeforeMemberSignal.members.find(
          ({ pid }) => pid === capturedMember.pid,
        );
        if (member === undefined) continue;
        try {
          process.kill(member.pid, force ? "SIGKILL" : "SIGTERM");
        } catch (memberError) {
          if (!processSignalFailed(memberError)) throw memberError;
        }
      }
    }
  }

  async #waitForExit(
    processes: readonly AionCoreProbeOwnedProcess[],
    milliseconds: number,
  ): Promise<void> {
    const deadline = Date.now() + milliseconds;
    while ((await this.#liveOwnedProcesses(processes)).length > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      // eslint-disable-next-line no-await-in-loop -- process-group exit is observed to a fixed deadline.
      await boundedDelay(Math.min(remaining, 10));
    }
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function standardText(
  value: unknown,
  label: string,
  maximumBytes = 256,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    new TextEncoder().encode(value).byteLength > maximumBytes ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
    })
  ) {
    throw new AionUiTeamBridgePortError("team-model-unavailable", `${label} is invalid`);
  }
  return value;
}

/**
 * Collapses a free-form Worker reply into the single-line, control-free,
 * NFC-normalized shape the native Team activity contract accepts.
 */
function boundedActivityContent(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  let result = "";
  let bytes = 0;
  for (const character of normalized) {
    const nextBytes = new TextEncoder().encode(character).byteLength;
    if (bytes + nextBytes > MAX_TEAM_ACTIVITY_CONTENT_BYTES) break;
    result += character;
    bytes += nextBytes;
  }
  return result.trim();
}

function modelIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)
  ) {
    return null;
  }
  return value;
}

interface AionUiStandardModelCatalog {
  readonly currentModel: string | null;
  readonly admittedModels: ReadonlySet<string>;
}

interface AionUiStandardConfigOptionChoice {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

interface AionUiStandardConfigOption {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly type: "select";
  readonly current_value: string | null;
  readonly options: readonly AionUiStandardConfigOptionChoice[];
}

interface AionUiStandardConfigOptions extends NativeAionUiTeamConfigOptions {
  readonly config_options: readonly AionUiStandardConfigOption[];
}

function optionalStandardText(value: unknown, label: string, maximumBytes: number): string | null {
  if (value === undefined || value === null) return null;
  return standardText(value, label, maximumBytes);
}

function standardConfigOptions(value: unknown): AionUiStandardConfigOptions {
  const parsed = parseJson(value);
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.config_options) ||
    parsed.config_options.length > 16
  ) {
    throw new AionUiTeamBridgePortError(
      "team-model-unavailable",
      "The standard Team runtime model catalog is invalid",
    );
  }
  const configOptions = parsed.config_options.map((candidate): AionUiStandardConfigOption => {
    if (!isRecord(candidate) || (candidate.type ?? candidate.option_type) !== "select") {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team runtime option is invalid",
      );
    }
    const id = standardText(candidate.id, "Team runtime option identity", 128);
    const category = standardText(candidate.category, "Team runtime option category", 128);
    const name = standardText(candidate.name ?? id, "Team runtime option name", 256);
    if (!Array.isArray(candidate.options) || candidate.options.length > 128) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team runtime choices are invalid",
      );
    }
    const choices = Object.freeze(
      candidate.options.map((choice): AionUiStandardConfigOptionChoice => {
        if (!isRecord(choice)) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The standard Team runtime choice is invalid",
          );
        }
        const choiceValue = modelIdentifier(choice.value ?? choice.id);
        if (choiceValue === null) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The standard Team runtime choice identity is invalid",
          );
        }
        const description = optionalStandardText(
          choice.description,
          "Team runtime choice description",
          1_024,
        );
        return Object.freeze({
          value: choiceValue,
          name: standardText(
            choice.name ?? choice.label ?? choiceValue,
            "Team runtime choice name",
            256,
          ),
          ...(description === null ? {} : { description }),
        });
      }),
    );
    const currentValue =
      candidate.current_value === undefined || candidate.current_value === null
        ? null
        : modelIdentifier(candidate.current_value);
    if (
      candidate.current_value !== undefined &&
      candidate.current_value !== null &&
      currentValue === null
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team runtime current value is invalid",
      );
    }
    return Object.freeze({
      id,
      name,
      category,
      type: "select",
      current_value: currentValue,
      options: choices,
    });
  });
  return Object.freeze({ config_options: Object.freeze(configOptions) });
}

function standardModelOption(value: AionUiStandardConfigOptions): AionUiStandardConfigOption {
  const models = value.config_options.filter(
    (candidate) => candidate.category === "model" || candidate.id === "model",
  );
  if (models.length !== 1 || models[0]!.options.length === 0) {
    throw new AionUiTeamBridgePortError(
      "team-model-unavailable",
      "The standard Team runtime model catalog is unavailable",
    );
  }
  return models[0]!;
}

const SAFE_STANDARD_TEAM_SESSION_MODES = new Set(["auto", "default", "plan", "read-only"]);

function standardModeOption(value: AionUiStandardConfigOptions): AionUiStandardConfigOption {
  const modes = value.config_options.filter(
    (candidate) => candidate.category === "mode" || candidate.id === "mode",
  );
  if (modes.length !== 1 || modes[0]!.options.length === 0) {
    throw new AionUiTeamBridgePortError(
      "team-model-unavailable",
      "The standard Team runtime mode catalog is unavailable",
    );
  }
  return modes[0]!;
}

function memberSessionMode(backend: string, canonicalMode: string): string {
  return canonicalMode === "default" && backend === "codex" ? "auto" : canonicalMode;
}

function modelOptions(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const option of value) {
    const candidate =
      typeof option === "string"
        ? option
        : isRecord(option)
          ? typeof option.id === "string"
            ? option.id
            : option.value
          : null;
    const stable = modelIdentifier(candidate);
    if (stable !== null && !result.includes(stable)) result.push(stable);
  }
  return Object.freeze(result);
}

function catalogFromConfigOptions(value: unknown): AionUiStandardModelCatalog | null {
  const parsed = parseJson(value);
  const options = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.config_options)
      ? parsed.config_options
      : [];
  const model = options.find(
    (candidate) =>
      isRecord(candidate) && candidate.category === "model" && candidate.type === "select",
  );
  if (!isRecord(model)) return null;
  const admittedModels = new Set(modelOptions(model.options));
  if (admittedModels.size === 0) return null;
  const currentModel = modelIdentifier(
    model.current_value ?? model.selected_value ?? model.currentValue,
  );
  return Object.freeze({ currentModel, admittedModels });
}

function catalogFromAvailableModels(value: unknown): AionUiStandardModelCatalog | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  const admittedModels = new Set(modelOptions(parsed.available_models));
  if (admittedModels.size === 0) return null;
  const currentModel = modelIdentifier(parsed.current_model_id ?? parsed.currentModelId);
  return Object.freeze({ currentModel, admittedModels });
}

function managedModelCatalog(value: unknown): AionUiStandardModelCatalog | null {
  if (!isRecord(value)) return null;
  return (
    catalogFromConfigOptions(value.config_options) ??
    catalogFromAvailableModels(value.available_models) ??
    (isRecord(value.handshake)
      ? (catalogFromConfigOptions(value.handshake.config_options) ??
        catalogFromAvailableModels(value.handshake.available_models))
      : null)
  );
}

function aionCoreDefaultModelAlias(managedAgent: Record<string, unknown>): string | null {
  const agentType = modelIdentifier(managedAgent.agent_type);
  if (agentType === "aionrs") return "default";
  if (agentType !== "acp") return null;
  return modelIdentifier(managedAgent.backend) === "gemini" ? null : "default";
}

function aionCoreCatalogDefaultModel(
  managedAgent: Record<string, unknown>,
  catalog: AionUiStandardModelCatalog,
): string | null {
  const agentType = modelIdentifier(managedAgent.agent_type);
  const backend = modelIdentifier(managedAgent.backend);
  if (agentType === "acp" && backend === "gemini") {
    for (const candidate of catalog.admittedModels) {
      if (candidate.startsWith("auto-gemini-")) return candidate;
    }
    return catalog.admittedModels.has("auto") ? "auto" : null;
  }
  if (agentType === "aionrs" || agentType === "acp") {
    return catalog.admittedModels.has("default") ? "default" : null;
  }
  return null;
}

function assistantDesiredModel(
  assistant: Record<string, unknown>,
  requestedModel: string | null,
): string | null {
  if (requestedModel !== null) return modelIdentifier(requestedModel);
  const defaults = isRecord(assistant.defaults) ? assistant.defaults : null;
  const model = defaults !== null && isRecord(defaults.model) ? defaults.model : null;
  if (model?.mode === "fixed") {
    const fixed = modelIdentifier(model.value);
    if (fixed !== null) return fixed;
  }
  const preferences = isRecord(assistant.preferences) ? assistant.preferences : null;
  return preferences === null ? null : modelIdentifier(preferences.last_model_id);
}

function resolveStandardTeamModel(
  assistant: Record<string, unknown>,
  managedAgent: Record<string, unknown>,
  requestedModel: string | null,
  discoveredCatalog: AionUiStandardModelCatalog | null = null,
): string {
  const catalog = discoveredCatalog ?? managedModelCatalog(managedAgent);
  if (catalog === null) {
    const defaultAlias = requestedModel === null ? aionCoreDefaultModelAlias(managedAgent) : null;
    if (defaultAlias !== null) return defaultAlias;
    throw new AionUiTeamBridgePortError(
      "team-model-unavailable",
      "The selected Team member has no authoritative model catalog",
    );
  }
  if (requestedModel !== null) {
    const requested = modelIdentifier(requestedModel);
    if (requested === null || !catalog.admittedModels.has(requested)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The requested Team model is not admitted by AionCore",
      );
    }
    return requested;
  }
  const desired = assistantDesiredModel(assistant, null);
  if (desired !== null && catalog.admittedModels.has(desired)) return desired;
  if (catalog.currentModel !== null && catalog.admittedModels.has(catalog.currentModel)) {
    return catalog.currentModel;
  }
  const defaultModel = aionCoreCatalogDefaultModel(managedAgent, catalog);
  if (defaultModel !== null) return defaultModel;
  throw new AionUiTeamBridgePortError(
    "team-model-unavailable",
    "The selected Team member has no admitted current model",
  );
}

function standardStatus(value: unknown): NativeAionUiStandardTeamAssistant["status"] {
  switch (value) {
    case "working":
    case "thinking":
    case "tool_use":
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "error":
    case "failed":
      return "failed";
    case "dormant":
      return "dormant";
    case "pending":
      return "pending";
    default:
      return "idle";
  }
}

function standardTeamBackendPort(code: AionUiTeamBridgePortError["code"]): number {
  const value = (globalThis as typeof globalThis & { __backendPort?: unknown }).__backendPort;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new AionUiTeamBridgePortError(code, "The AionCore loopback runtime is unavailable");
  }
  return value as number;
}

async function boundedStandardTeamResponse(
  response: Response,
  code: AionUiTeamBridgePortError["code"],
  allowVoidSuccess: boolean,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    if (response.ok && allowVoidSuccess) return undefined;
    throw new AionUiTeamBridgePortError(code, "The AionCore response body is unavailable");
  }
  if (
    response.ok &&
    allowVoidSuccess &&
    !response.headers.get("Content-Type")?.includes("application/json")
  ) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    // eslint-disable-next-line no-await-in-loop -- a response stream must be read in order.
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_STANDARD_TEAM_BACKEND_BODY_BYTES) {
      try {
        // eslint-disable-next-line no-await-in-loop -- cancellation belongs to this stream read.
        await reader.cancel();
      } catch {
        // The response is already rejected; cancellation is best effort.
      }
      throw new AionUiTeamBridgePortError(code, "The AionCore response exceeded the size limit");
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
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AionUiTeamBridgePortError(code, "The AionCore response is not valid UTF-8");
  }
  if (text.length === 0) {
    if (response.ok && allowVoidSuccess) return undefined;
    throw new AionUiTeamBridgePortError(code, "The AionCore response is empty");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AionUiTeamBridgePortError(code, "The AionCore response is not valid JSON");
  }
}

export class LoopbackAionUiStandardTeamBackend implements AionUiStandardTeamBackendPort {
  readonly #probeProcessGuard: AionUiStandardTeamProbeProcessGuardPort;
  readonly #activeProbeControllers = new Set<AbortController>();
  readonly #activeProbeDiscoveries = new Set<Promise<unknown>>();
  readonly #cleanupFailures: unknown[] = [];
  #closed = false;

  constructor(options?: LoopbackAionUiStandardTeamBackendOptions) {
    if (options?.probeProcessGuard === undefined || options.probeProcessGuard === null) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The AionCore probe process guard is required",
      );
    }
    this.#probeProcessGuard = options.probeProcessGuard;
  }

  async getAssistant(assistantIdentity: string): Promise<unknown> {
    const stableAssistantId = standardText(assistantIdentity, "Team assistant identity");
    return this.#request(
      "GET",
      `/api/assistants/${encodeURIComponent(stableAssistantId)}`,
      undefined,
      "team-model-unavailable",
    );
  }

  async listManagedAgents(): Promise<unknown> {
    return this.#request("GET", "/api/agents/management", undefined, "team-model-unavailable");
  }

  discoverAssistantModelCatalog(assistantIdentity: string): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(
        new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The standard Team model catalog backend is closed",
        ),
      );
    }
    const controller = new AbortController();
    this.#activeProbeControllers.add(controller);
    const discovery = this.#discoverAssistantModelCatalog(assistantIdentity, controller.signal);
    this.#activeProbeDiscoveries.add(discovery);
    void discovery
      .finally(() => {
        this.#activeProbeControllers.delete(controller);
        this.#activeProbeDiscoveries.delete(discovery);
      })
      .catch(() => {});
    return discovery;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#activeProbeControllers) controller.abort();
    await Promise.allSettled(this.#activeProbeDiscoveries);
    if (this.#cleanupFailures.length > 0) {
      throw new AggregateError(
        this.#cleanupFailures,
        "The standard Team model catalog backend cleanup failed",
      );
    }
  }

  async #discoverAssistantModelCatalog(
    assistantIdentity: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (process.platform === "win32") {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Stable Windows process identity is unavailable for temporary Team model cleanup",
      );
    }
    const stableAssistantId = standardText(assistantIdentity, "Team assistant identity");
    let probeConversationId: string | null = null;
    let discoveredCatalog: unknown;
    let discoveryFailure: unknown;
    let probeProcessSnapshot: AionCoreProbeProcessSnapshot | undefined;
    let cleanupFailure: unknown;
    try {
      const created = await this.#request(
        "POST",
        "/api/conversations",
        Object.freeze({
          name: "Actestra Team model catalog probe",
          assistant: Object.freeze({ id: stableAssistantId }),
          extra: Object.freeze({ is_health_check: true }),
        }),
        "team-model-unavailable",
        STANDARD_TEAM_BACKEND_TIMEOUT_MS,
        signal,
      );
      if (!isRecord(created)) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The temporary Team model catalog conversation is invalid",
        );
      }
      probeConversationId = standardText(
        created.id,
        "Temporary Team model catalog conversation identity",
      );
      const projectedAssistant = isRecord(created.assistant) ? created.assistant : null;
      const projectedExtra = isRecord(created.extra) ? created.extra : null;
      if (
        projectedAssistant?.id !== stableAssistantId ||
        projectedExtra?.is_temporary_workspace !== true ||
        projectedExtra.is_health_check !== true
      ) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The temporary Team model catalog conversation postcondition failed",
        );
      }
      discoveredCatalog = await this.#request(
        "POST",
        `/api/conversations/${encodeURIComponent(probeConversationId)}/runtime/ensure`,
        undefined,
        "team-model-unavailable",
        STANDARD_TEAM_RUNTIME_DISCOVERY_TIMEOUT_MS,
        signal,
      );
      if (managedModelCatalog(discoveredCatalog) === null) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The temporary Team runtime exposed no authoritative model catalog",
        );
      }
    } catch (error) {
      discoveryFailure = error;
    }
    if (probeConversationId !== null) {
      try {
        probeProcessSnapshot = await this.#probeProcessGuard.capture(probeConversationId);
      } catch (error) {
        cleanupFailure = error;
      }
      if (probeProcessSnapshot !== undefined) {
        try {
          await this.#voidRequest(
            "DELETE",
            `/api/conversations/${encodeURIComponent(probeConversationId)}`,
            undefined,
            "team-model-unavailable",
          );
        } catch (error) {
          cleanupFailure ??= error;
        }
        try {
          await this.#probeProcessGuard.cleanup(probeProcessSnapshot);
        } catch (error) {
          cleanupFailure ??= error;
        }
      }
    }
    if (cleanupFailure !== undefined) {
      this.#cleanupFailures.push(cleanupFailure);
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The temporary Team model catalog conversation could not be cleaned up",
      );
    }
    if (discoveryFailure !== undefined) throw discoveryFailure;
    return discoveredCatalog;
  }

  async createTeam(body: unknown): Promise<unknown> {
    return this.#request("POST", "/api/teams", body, "team-execution-failed");
  }

  async listTeams(): Promise<unknown> {
    return this.#request(
      "GET",
      "/api/teams?user_id=system_default_user",
      undefined,
      "team-execution-failed",
    );
  }

  async getTeam(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#request(
      "GET",
      `/api/teams/${encodeURIComponent(stableTeamId)}`,
      undefined,
      "team-not-found",
    );
  }

  async renameTeam(teamIdentity: string, name: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableName = standardText(name, "Team name");
    return this.#voidRequest(
      "PATCH",
      `/api/teams/${encodeURIComponent(stableTeamId)}/name`,
      Object.freeze({ name: stableName }),
      "team-conflict",
    );
  }

  async removeTeam(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#voidRequest(
      "DELETE",
      `/api/teams/${encodeURIComponent(stableTeamId)}`,
      undefined,
      "team-conflict",
    );
  }

  async addTeamMember(teamIdentity: string, body: unknown): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#request(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/agents`,
      body,
      "team-execution-failed",
    );
  }

  async renameTeamMember(
    teamIdentity: string,
    slotIdentity: string,
    name: string,
  ): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    const stableName = standardText(name, "Team member name");
    return this.#voidRequest(
      "PATCH",
      `/api/teams/${encodeURIComponent(stableTeamId)}/agents/${encodeURIComponent(stableSlotId)}/name`,
      Object.freeze({ name: stableName }),
      "team-conflict",
    );
  }

  async removeTeamMember(teamIdentity: string, slotIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    return this.#voidRequest(
      "DELETE",
      `/api/teams/${encodeURIComponent(stableTeamId)}/agents/${encodeURIComponent(stableSlotId)}`,
      undefined,
      "team-conflict",
    );
  }

  async setTeamSessionMode(teamIdentity: string, mode: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableMode = modelIdentifier(mode);
    if (stableMode === null) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The requested standard Team session mode is invalid",
      );
    }
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/session-mode`,
      Object.freeze({ mode: stableMode }),
      "team-model-unavailable",
    );
  }

  async ensureTeamSession(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/session`,
      undefined,
      "team-model-unavailable",
    );
  }

  async stopTeamSession(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#voidRequest(
      "DELETE",
      `/api/teams/${encodeURIComponent(stableTeamId)}/session`,
      undefined,
      "team-model-unavailable",
    );
  }

  async cancelTeamRun(teamIdentity: string, runIdentity: string, body: unknown): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableRunId = standardText(runIdentity, "Team run identity");
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/runs/${encodeURIComponent(stableRunId)}/cancel`,
      body,
      "team-execution-failed",
    );
  }

  async renewTeamActiveLease(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/active-lease`,
      undefined,
      "team-execution-failed",
    );
  }

  async sendTeamMessage(teamIdentity: string, body: unknown): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#request(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/messages`,
      body,
      "team-execution-failed",
    );
  }

  async sendTeamMemberMessage(
    teamIdentity: string,
    slotIdentity: string,
    body: unknown,
  ): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    return this.#request(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/agents/${encodeURIComponent(stableSlotId)}/messages`,
      body,
      "team-execution-failed",
    );
  }

  async getTeamRunState(teamIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#request(
      "GET",
      `/api/teams/${encodeURIComponent(stableTeamId)}/run-state`,
      undefined,
      "team-execution-failed",
    );
  }

  async pauseTeamMemberWork(
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    body: unknown,
  ): Promise<unknown> {
    return this.#mutateTeamMemberWork(teamIdentity, runIdentity, slotIdentity, "pause", body);
  }

  async cancelTeamMemberWork(
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    body: unknown,
  ): Promise<unknown> {
    return this.#mutateTeamMemberWork(teamIdentity, runIdentity, slotIdentity, "cancel", body);
  }

  async attachTeamMember(teamIdentity: string, slotIdentity: string): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/agents/${encodeURIComponent(stableSlotId)}/attach`,
      undefined,
      "team-conflict",
    );
  }

  async #mutateTeamMemberWork(
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    action: "cancel" | "pause",
    body: unknown,
  ): Promise<unknown> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableRunId = standardText(runIdentity, "Team run identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    return this.#voidRequest(
      "POST",
      `/api/teams/${encodeURIComponent(stableTeamId)}/runs/${encodeURIComponent(stableRunId)}/agents/${encodeURIComponent(stableSlotId)}/${action}`,
      body,
      "team-conflict",
    );
  }

  async reconcileConfigOptions(
    teamIdentity: string,
    conversationIdentity: string,
  ): Promise<AionUiStandardConfigOptions> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableConversationId = standardText(conversationIdentity, "Team conversation identity");
    const team = await this.#request(
      "GET",
      `/api/teams/${encodeURIComponent(stableTeamId)}`,
      undefined,
      "team-model-unavailable",
    );
    if (!isRecord(team) || !Array.isArray(team.assistants)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team persistence projection is invalid",
      );
    }
    const matchingMembers = team.assistants.filter(
      (candidate) => isRecord(candidate) && candidate.conversation_id === stableConversationId,
    );
    if (matchingMembers.length !== 1) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team conversation is not an admitted member",
      );
    }
    const conversation = await this.#request(
      "GET",
      `/api/conversations/${encodeURIComponent(stableConversationId)}`,
      undefined,
      "team-model-unavailable",
    );
    const extra =
      isRecord(conversation) && isRecord(conversation.extra) ? conversation.extra : null;
    const persistedModel = extra === null ? null : modelIdentifier(extra.current_model_id);
    if (
      conversation === null ||
      !isRecord(conversation) ||
      conversation.id !== stableConversationId ||
      persistedModel === null
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team persisted model selection is unavailable",
      );
    }
    const currentOptions = standardConfigOptions(
      await this.#request(
        "GET",
        `/api/teams/${encodeURIComponent(stableTeamId)}/conversations/${encodeURIComponent(stableConversationId)}/config-options`,
        undefined,
        "team-model-unavailable",
      ),
    );
    // AionRS owns its model selection through the Provider configuration and
    // exposes only permission/session modes from this endpoint. ACP members,
    // by contrast, must expose and reconcile a Main-admitted model catalog.
    // Do not apply the ACP model-catalog requirement to an AionRS member.
    const memberBackend = modelIdentifier(
      matchingMembers[0]!.assistant_backend ?? matchingMembers[0]!.backend,
    );
    if (memberBackend === "aionrs" || conversation.type === "aionrs") {
      return currentOptions;
    }
    const currentModelOption = standardModelOption(currentOptions);
    if (!currentModelOption.options.some(({ value }) => value === persistedModel)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team persisted model is no longer admitted",
      );
    }
    if (currentModelOption.current_value === persistedModel) return currentOptions;

    const observed = await this.#request(
      "PUT",
      `/api/conversations/${encodeURIComponent(stableConversationId)}/config-options/model`,
      Object.freeze({ value: persistedModel }),
      "team-model-unavailable",
    );
    if (!isRecord(observed) || observed.confirmation !== "observed") {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team model reconciliation was not observed",
      );
    }
    const observedOptions = standardConfigOptions(observed);
    const observedModelOption = standardModelOption(observedOptions);
    if (
      observedModelOption.current_value !== persistedModel ||
      !observedModelOption.options.some(({ value }) => value === persistedModel)
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team model reconciliation postcondition failed",
      );
    }
    return observedOptions;
  }

  async setConfigOption(
    teamIdentity: string,
    conversationIdentity: string,
    optionIdentity: string,
    value: string,
  ): Promise<NativeAionUiTeamConfigOptions> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableConversationId = standardText(conversationIdentity, "Team conversation identity");
    const stableOptionId = standardText(optionIdentity, "Team config option identity");
    const stableValue = modelIdentifier(value);
    if (stableValue === null) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The requested standard Team config value is invalid",
      );
    }
    const current = await this.reconcileConfigOptions(stableTeamId, stableConversationId);
    const option = current.config_options.find(({ id }) => id === stableOptionId);
    if (
      option === undefined ||
      !option.options.some(({ value: candidate }) => candidate === stableValue)
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The requested standard Team config value is not admitted",
      );
    }
    const observed = await this.#request(
      "PUT",
      `/api/conversations/${encodeURIComponent(stableConversationId)}/config-options/${encodeURIComponent(stableOptionId)}`,
      Object.freeze({ value: stableValue }),
      "team-model-unavailable",
    );
    const observedOptions = standardConfigOptions(observed);
    const observedOption = observedOptions.config_options.find(({ id }) => id === stableOptionId);
    if (observedOption === undefined || observedOption.current_value !== stableValue) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The standard Team config option postcondition was not observed",
      );
    }
    return observedOptions;
  }

  async #voidRequest(
    method: "DELETE" | "PATCH" | "POST",
    requestPath: string,
    body: unknown,
    code: AionUiTeamBridgePortError["code"],
  ): Promise<unknown> {
    return this.#request(
      method,
      requestPath,
      body,
      code,
      STANDARD_TEAM_BACKEND_TIMEOUT_MS,
      undefined,
      true,
    );
  }

  async #request(
    method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
    requestPath: string,
    body: unknown,
    code: AionUiTeamBridgePortError["code"],
    timeoutMs = STANDARD_TEAM_BACKEND_TIMEOUT_MS,
    signal?: AbortSignal,
    allowVoidSuccess = false,
  ): Promise<unknown> {
    let serializedBody: string | undefined;
    if (body !== undefined) {
      try {
        serializedBody = JSON.stringify(body);
      } catch {
        throw new AionUiTeamBridgePortError(code, "The AionCore request body is invalid");
      }
      if (
        serializedBody === undefined ||
        new TextEncoder().encode(serializedBody).byteLength > MAX_STANDARD_TEAM_BACKEND_BODY_BYTES
      ) {
        throw new AionUiTeamBridgePortError(
          code,
          "The AionCore request body exceeded the size limit",
        );
      }
    }
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${standardTeamBackendPort(code)}${requestPath}`, {
        method,
        ...(serializedBody === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: serializedBody,
            }),
        signal:
          signal === undefined
            ? AbortSignal.timeout(timeoutMs)
            : AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
      });
    } catch (error) {
      if (error instanceof AionUiTeamBridgePortError) throw error;
      throw new AionUiTeamBridgePortError(code, "The AionCore loopback request failed");
    }
    const parsed = await boundedStandardTeamResponse(response, code, allowVoidSuccess);
    if (!response.ok) {
      throw new AionUiTeamBridgePortError(code, "The AionCore loopback request was rejected");
    }
    if (isRecord(parsed) && Object.hasOwn(parsed, "data")) return parsed.data;
    return parsed;
  }
}

export class AionUiStandardTeamCreationService {
  readonly #backend: AionUiStandardTeamBackendPort;

  constructor(options: AionUiStandardTeamCreationServiceOptions) {
    this.#backend = options.backend;
  }

  async list(): Promise<readonly NativeAionUiStandardTeam[]> {
    const teams = await this.#backend.listTeams();
    if (!Array.isArray(teams)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team list projection is invalid",
      );
    }
    return Object.freeze(teams.map((team) => this.#projectStoredTeam(team)));
  }

  async get(teamIdentity: string): Promise<NativeAionUiStandardTeam> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    return this.#getExpectedTeam(stableTeamId);
  }

  async create(
    intent: Extract<AionUiTeamBridgeRoute, { kind: "create-standard" }>,
  ): Promise<NativeAionUiStandardTeam> {
    const resolvedMembers = await this.#resolveMembers(intent.members);

    const body = Object.freeze({
      name: intent.name,
      workspace: intent.workspace,
      agents: Object.freeze(
        resolvedMembers.map(({ member, model }) =>
          Object.freeze({
            name: member.displayName,
            role: member.role === "leader" ? "lead" : "teammate",
            assistant_id: member.assistantId,
            model,
          }),
        ),
      ),
    });
    const persisted = await this.#backend.createTeam(body);
    try {
      const created = this.#projectPersistedTeam(intent, resolvedMembers, persisted);
      if (this.#backend.setTeamSessionMode === undefined || this.#backend.getTeam === undefined) {
        throw new AionUiTeamBridgePortError(
          "team-unavailable",
          "Standard Team safe session initialization is unavailable",
        );
      }
      await this.#backend.setTeamSessionMode(created.id, "default");
      const observed = this.#projectPersistedTeam(
        intent,
        resolvedMembers,
        await this.#backend.getTeam(created.id),
        created.id,
      );
      if (observed.session_mode !== undefined && observed.session_mode !== "default") {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team safe session mode was not persisted",
        );
      }
      return Object.freeze({ ...observed, session_mode: "default" });
    } catch (error) {
      const persistedTeamId = isRecord(persisted) ? modelIdentifier(persisted.id) : null;
      if (persistedTeamId !== null && this.#backend.removeTeam !== undefined) {
        try {
          await this.#backend.removeTeam(persistedTeamId);
        } catch {
          throw new AionUiTeamBridgePortError(
            "team-conflict",
            "The invalid standard Team could not be cleaned up",
          );
        }
      }
      throw error;
    }
  }

  async addMember(
    intent: Extract<AionUiTeamBridgeRoute, { kind: "add-standard-member" }>,
  ): Promise<NativeAionUiStandardTeamMemberAck> {
    if (this.#backend.addTeamMember === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member creation is unavailable",
      );
    }
    const [resolved] = await this.#resolveMembers([intent.member]);
    const persisted = await this.#backend.addTeamMember(intent.teamId, {
      assistant: {
        name: resolved!.member.displayName,
        role: "teammate",
        assistant_id: resolved!.member.assistantId,
        model: resolved!.model,
      },
    });
    return Object.freeze({
      experience: "standard",
      assistant: this.#projectPersistedAssistant(resolved!, persisted),
    });
  }

  async remove(teamIdentity: string): Promise<void> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    await this.#backend.removeTeam(stableTeamId);
    const observed = await this.list();
    if (observed.some(({ id }) => id === stableTeamId)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team deletion postcondition was not observed",
      );
    }
  }

  async rename(teamIdentity: string, name: string): Promise<NativeAionUiStandardTeam> {
    if (this.#backend.renameTeam === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team rename is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableName = standardText(name, "Team name");
    await this.#backend.renameTeam(stableTeamId, stableName);
    const observed = await this.#getExpectedTeam(stableTeamId);
    if (observed.id !== stableTeamId || observed.name !== stableName) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team rename postcondition was not observed",
      );
    }
    return observed;
  }

  async renameMember(
    teamIdentity: string,
    slotIdentity: string,
    name: string,
  ): Promise<NativeAionUiStandardTeam> {
    if (this.#backend.renameTeamMember === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member rename is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    const stableName = standardText(name, "Team member name");
    await this.#backend.renameTeamMember(stableTeamId, stableSlotId, stableName);
    const observed = await this.#getExpectedTeam(stableTeamId);
    const member = observed.assistants.find(({ slot_id }) => slot_id === stableSlotId);
    if (member?.assistant_name !== stableName) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team member rename postcondition was not observed",
      );
    }
    return observed;
  }

  async removeMember(teamIdentity: string, slotIdentity: string): Promise<void> {
    if (this.#backend.removeTeamMember === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member removal is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    await this.#backend.removeTeamMember(stableTeamId, stableSlotId);
    const observed = await this.#getExpectedTeam(stableTeamId);
    if (observed.assistants.some(({ slot_id }) => slot_id === stableSlotId)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team member removal postcondition was not observed",
      );
    }
  }

  async loadConfigOptions(
    teamId: string,
    conversationId: string,
  ): Promise<NativeAionUiTeamConfigOptions> {
    if (this.#backend.reconcileConfigOptions === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Standard Team model reconciliation is unavailable",
      );
    }
    return this.#backend.reconcileConfigOptions(teamId, conversationId);
  }

  async setConfigOption(
    teamId: string,
    conversationId: string,
    optionId: string,
    value: string,
  ): Promise<NativeAionUiTeamConfigOptions> {
    if (optionId === "mode") {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Standard Team mode changes require the Team session boundary",
      );
    }
    if (this.#backend.setConfigOption === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Standard Team config changes are unavailable",
      );
    }
    return this.#backend.setConfigOption(teamId, conversationId, optionId, value);
  }

  async setSessionMode(
    teamIdentity: string,
    conversationIdentity: string,
    mode: string,
  ): Promise<NativeAionUiStandardTeam> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableConversationId = standardText(conversationIdentity, "Team conversation identity");
    const stableMode = modelIdentifier(mode);
    if (stableMode === null || !SAFE_STANDARD_TEAM_SESSION_MODES.has(stableMode)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The requested standard Team session mode is unavailable",
      );
    }
    if (
      this.#backend.reconcileConfigOptions === undefined ||
      this.#backend.setConfigOption === undefined ||
      this.#backend.setTeamSessionMode === undefined
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Standard Team session mode coordination is unavailable",
      );
    }

    const team = await this.#getExpectedTeam(stableTeamId);
    const leader = team.assistants.find(({ role }) => role === "leader");
    if (leader?.conversation_id !== stableConversationId) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Only the standard Team leader can select the session mode",
      );
    }

    const admitted = await Promise.all(
      team.assistants.map(async (assistant) => {
        const targetMode = memberSessionMode(assistant.assistant_backend, stableMode);
        const options = standardConfigOptions(
          await this.#backend.reconcileConfigOptions!(stableTeamId, assistant.conversation_id),
        );
        const modeOption = standardModeOption(options);
        if (!modeOption.options.some(({ value }) => value === targetMode)) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The requested mode is not admitted by every standard Team member",
          );
        }
        return Object.freeze({
          assistant,
          targetMode,
          optionId: modeOption.id,
        });
      }),
    );

    for (const { assistant, optionId, targetMode } of admitted) {
      const observed = standardConfigOptions(
        await this.#backend.setConfigOption(
          stableTeamId,
          assistant.conversation_id,
          optionId,
          targetMode,
        ),
      );
      if (standardModeOption(observed).current_value !== targetMode) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The standard Team member mode postcondition was not observed",
        );
      }
    }

    await this.#backend.setTeamSessionMode(stableTeamId, stableMode);
    const observedTeam = await this.#getExpectedTeam(stableTeamId);
    if (observedTeam.session_mode !== undefined && observedTeam.session_mode !== stableMode) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team session mode postcondition was not observed",
      );
    }
    for (const { assistant, targetMode } of admitted) {
      const observed = standardConfigOptions(
        await this.#backend.reconcileConfigOptions(stableTeamId, assistant.conversation_id),
      );
      if (standardModeOption(observed).current_value !== targetMode) {
        throw new AionUiTeamBridgePortError(
          "team-model-unavailable",
          "The standard Team member mode changed before acknowledgement",
        );
      }
    }
    return Object.freeze({ ...observedTeam, session_mode: stableMode });
  }

  async ensureSession(teamIdentity: string): Promise<NativeAionUiStandardTeam> {
    const stableTeamId = standardText(teamIdentity, "Team identity");
    if (
      this.#backend.getTeam === undefined ||
      this.#backend.setTeamSessionMode === undefined ||
      this.#backend.ensureTeamSession === undefined ||
      this.#backend.stopTeamSession === undefined ||
      this.#backend.reconcileConfigOptions === undefined ||
      this.#backend.setConfigOption === undefined
    ) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "Standard Team safe session warmup is unavailable",
      );
    }

    const current = await this.#getExpectedTeam(stableTeamId);
    const stableMode =
      current.session_mode !== undefined &&
      SAFE_STANDARD_TEAM_SESSION_MODES.has(current.session_mode)
        ? current.session_mode
        : "default";
    await this.#backend.setTeamSessionMode(stableTeamId, stableMode);
    const seeded = await this.#getExpectedTeam(stableTeamId);
    if (seeded.session_mode !== undefined && seeded.session_mode !== stableMode) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team safe session seed was not persisted",
      );
    }

    try {
      await this.#backend.ensureTeamSession(stableTeamId);
      const leader = seeded.assistants.find(({ role }) => role === "leader");
      if (leader === undefined) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team leader is unavailable after warmup",
        );
      }
      return await this.setSessionMode(stableTeamId, leader.conversation_id, stableMode);
    } catch (error) {
      try {
        await this.#backend.stopTeamSession(stableTeamId);
      } catch {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The invalid standard Team session could not be stopped",
        );
      }
      throw error;
    }
  }

  async renewActiveLease(teamIdentity: string): Promise<void> {
    if (this.#backend.renewTeamActiveLease === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team active-lease renewal is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    await this.#backend.renewTeamActiveLease(stableTeamId);
  }

  async sendMessage(
    teamIdentity: string,
    content: string,
    files: readonly string[],
  ): Promise<NativeAionUiStandardTeamRunAck> {
    return (await this.prepareMessageEffect(teamIdentity, content, files))();
  }

  async prepareMessageEffect(
    teamIdentity: string,
    content: string,
    files: readonly string[],
  ): Promise<AionUiPreparedStandardTeamMessageEffect> {
    if (
      this.#backend.sendTeamMessage === undefined ||
      this.#backend.getTeamRunState === undefined
    ) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team message coordination is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableContent = standardText(content, "Team message", 16 * 1024);
    const team = await this.#getExpectedTeam(stableTeamId);
    const stableFiles = await this.#resolveAttachmentPaths(team, files);
    const leader = team.assistants.find(({ role }) => role === "leader");
    if (leader === undefined) {
      throw new AionUiTeamBridgePortError("team-conflict", "Standard Team leader is unavailable");
    }
    return async () => {
      const acknowledgement = this.#projectRunAcknowledgement(
        team,
        await this.#backend.sendTeamMessage!(stableTeamId, {
          content: stableContent,
          files: stableFiles,
        }),
        leader.slot_id,
      );
      const observedState = await this.#backend.getTeamRunState!(stableTeamId);
      if (!isRecord(observedState) || !isRecord(observedState.active_run)) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team message run was not observed",
        );
      }
      const observedRun = this.#projectRunEvent(team, observedState.active_run, leader.slot_id);
      if (observedRun.team_run_id !== acknowledgement.run.team_run_id) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team message run postcondition was not observed",
        );
      }
      return acknowledgement;
    };
  }

  async sendMemberMessage(
    teamIdentity: string,
    slotIdentity: string,
    content: string,
    files: readonly string[],
  ): Promise<NativeAionUiStandardTeamRunAck> {
    return (await this.prepareMemberMessageEffect(teamIdentity, slotIdentity, content, files))();
  }

  async prepareMemberMessageEffect(
    teamIdentity: string,
    slotIdentity: string,
    content: string,
    files: readonly string[],
  ): Promise<AionUiPreparedStandardTeamMessageEffect> {
    if (
      this.#backend.sendTeamMemberMessage === undefined ||
      this.#backend.getTeamRunState === undefined
    ) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member-message coordination is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    const stableContent = standardText(content, "Team member message", 16 * 1024);
    const team = await this.#getExpectedTeam(stableTeamId);
    if (!team.assistants.some(({ slot_id }) => slot_id === stableSlotId)) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const stableFiles = await this.#resolveAttachmentPaths(team, files);
    return async () => {
      const acknowledgement = this.#projectRunAcknowledgement(
        team,
        await this.#backend.sendTeamMemberMessage!(stableTeamId, stableSlotId, {
          content: stableContent,
          files: stableFiles,
        }),
        stableSlotId,
      );
      const observedState = await this.#backend.getTeamRunState!(stableTeamId);
      if (!isRecord(observedState) || !isRecord(observedState.active_run)) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team member-message run was not observed",
        );
      }
      const observedRun = this.#projectRunEvent(team, observedState.active_run, stableSlotId);
      if (observedRun.team_run_id !== acknowledgement.run.team_run_id) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team member-message run postcondition was not observed",
        );
      }
      return acknowledgement;
    };
  }

  async getRunState(teamIdentity: string): Promise<NativeAionUiStandardTeamRunState> {
    if (this.#backend.getTeamRunState === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team run-state projection is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const team = await this.#getExpectedTeam(stableTeamId);
    return this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
  }

  async stopSession(teamIdentity: string): Promise<NativeAionUiStandardTeamRunState> {
    if (
      this.#backend.stopTeamSession === undefined ||
      this.#backend.getTeamRunState === undefined
    ) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team session stop is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const team = await this.#getExpectedTeam(stableTeamId);
    await this.#backend.stopTeamSession(stableTeamId);
    const observed = this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
    if (
      observed.active_run !== null &&
      (observed.active_run.status === "accepted" || observed.active_run.status === "running")
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team session stop postcondition was not observed",
      );
    }
    return observed;
  }

  async cancelRun(
    teamIdentity: string,
    runIdentity: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState> {
    if (this.#backend.cancelTeamRun === undefined || this.#backend.getTeamRunState === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team run cancellation is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableRunId = standardText(runIdentity, "Team run identity");
    const stableReason = standardText(reason, "Team cancellation reason", 2 * 1024);
    const team = await this.#getExpectedTeam(stableTeamId);
    const current = this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
    if (
      current.active_run === null ||
      current.active_run.team_run_id !== stableRunId ||
      (current.active_run.status !== "accepted" && current.active_run.status !== "running")
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team cancellation target is no longer current",
      );
    }
    await this.#backend.cancelTeamRun(stableTeamId, stableRunId, {
      reason: stableReason,
    });
    const observed = this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
    if (
      observed.active_run?.team_run_id === stableRunId &&
      (observed.active_run.status === "accepted" || observed.active_run.status === "running")
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team cancellation postcondition was not observed",
      );
    }
    return observed;
  }

  async pauseMemberWork(
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState> {
    return this.#controlMemberWork("pause", teamIdentity, runIdentity, slotIdentity, reason);
  }

  async cancelMemberWork(
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState> {
    return this.#controlMemberWork("cancel", teamIdentity, runIdentity, slotIdentity, reason);
  }

  async attachMember(
    teamIdentity: string,
    slotIdentity: string,
  ): Promise<NativeAionUiStandardTeam> {
    if (this.#backend.attachTeamMember === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member attach is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    const team = await this.#getExpectedTeam(stableTeamId);
    if (!team.assistants.some(({ slot_id }) => slot_id === stableSlotId)) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    await this.#backend.attachTeamMember(stableTeamId, stableSlotId);
    const observed = await this.#getExpectedTeam(stableTeamId);
    if (!observed.assistants.some(({ slot_id }) => slot_id === stableSlotId)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team member attach postcondition was not observed",
      );
    }
    return observed;
  }

  async #controlMemberWork(
    action: "cancel" | "pause",
    teamIdentity: string,
    runIdentity: string,
    slotIdentity: string,
    reason: string,
  ): Promise<NativeAionUiStandardTeamRunState> {
    const effect =
      action === "pause" ? this.#backend.pauseTeamMemberWork : this.#backend.cancelTeamMemberWork;
    if (effect === undefined || this.#backend.getTeamRunState === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team member control is unavailable",
      );
    }
    const stableTeamId = standardText(teamIdentity, "Team identity");
    const stableRunId = standardText(runIdentity, "Team run identity");
    const stableSlotId = standardText(slotIdentity, "Team member identity");
    const stableReason = standardText(reason, "Team control reason", 2 * 1024);
    const team = await this.#getExpectedTeam(stableTeamId);
    if (!team.assistants.some(({ slot_id }) => slot_id === stableSlotId)) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const current = this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
    const currentWork = current.slot_work.find(({ slot_id }) => slot_id === stableSlotId);
    if (
      current.active_run === null ||
      current.active_run.team_run_id !== stableRunId ||
      (current.active_run.status !== "accepted" && current.active_run.status !== "running") ||
      currentWork?.team_run_id !== stableRunId
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team member control target is no longer current",
      );
    }
    await effect.call(this.#backend, stableTeamId, stableRunId, stableSlotId, {
      reason: stableReason,
    });
    const observed = this.#projectRunState(team, await this.#backend.getTeamRunState(stableTeamId));
    const work = observed.slot_work.find(({ slot_id }) => slot_id === stableSlotId);
    if (
      work?.team_run_id === stableRunId &&
      (work.active_turn_id !== null || work.state === "starting" || work.state === "running")
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team member control postcondition was not observed",
      );
    }
    return observed;
  }

  async #resolveAttachmentPaths(
    team: NativeAionUiStandardTeam,
    files: readonly string[],
  ): Promise<readonly string[]> {
    if (files.length === 0) return Object.freeze([]);
    if (files.length > 32 || !path.isAbsolute(team.workspace)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Standard Team attachments require a bounded authoritative workspace",
      );
    }
    let canonicalWorkspace: string;
    try {
      canonicalWorkspace = await realpath(team.workspace);
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team workspace is unavailable",
      );
    }
    if (canonicalWorkspace === path.parse(canonicalWorkspace).root) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team workspace is too broad for attachments",
      );
    }
    const canonicalFiles: string[] = [];
    for (const file of files) {
      const boundedFile = standardText(file, "Team attachment", 4 * 1024);
      const requestedPath = path.isAbsolute(boundedFile)
        ? path.normalize(boundedFile)
        : path.resolve(canonicalWorkspace, boundedFile);
      let canonicalFile: string;
      try {
        canonicalFile = await realpath(requestedPath);
      } catch {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "A standard Team attachment is unavailable",
        );
      }
      const relative = path.relative(canonicalWorkspace, canonicalFile);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "A standard Team attachment is outside the authoritative workspace",
        );
      }
      if (!canonicalFiles.includes(canonicalFile)) canonicalFiles.push(canonicalFile);
    }
    return Object.freeze(canonicalFiles);
  }

  #projectRunAcknowledgement(
    team: NativeAionUiStandardTeam,
    value: unknown,
    expectedTargetSlotId: string,
  ): NativeAionUiStandardTeamRunAck {
    if (!isRecord(value)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team message acknowledgement is invalid",
      );
    }
    const acknowledgement = Object.freeze({
      experience: "standard" as const,
      enqueue_status: value.enqueue_status,
      message_id: value.message_id,
      run: this.#projectRunEvent(team, value.run, expectedTargetSlotId),
    });
    try {
      // The shared bridge assertion is intentionally exercised here so Main never
      // returns an unbounded provider-owned acknowledgement to the renderer.
      assertAionUiTeamBridgeResponse(
        Object.freeze({
          contractVersion: 1,
          status: 200,
          data: acknowledgement,
        }),
      );
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team message acknowledgement is invalid",
      );
    }
    return acknowledgement as NativeAionUiStandardTeamRunAck;
  }

  #projectRunState(
    team: NativeAionUiStandardTeam,
    value: unknown,
  ): NativeAionUiStandardTeamRunState {
    if (!isRecord(value) || !Array.isArray(value.slot_work)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run-state projection is invalid",
      );
    }
    const slotWork = Object.freeze(
      value.slot_work.map((candidate) => {
        if (!isRecord(candidate)) {
          throw new AionUiTeamBridgePortError(
            "team-conflict",
            "The standard Team slot projection is invalid",
          );
        }
        return Object.freeze({
          slot_id: candidate.slot_id,
          role: candidate.role,
          state: candidate.state,
          queued_foreground_count: candidate.queued_foreground_count,
          queued_background_count: candidate.queued_background_count,
          active_turn_id: candidate.active_turn_id,
          active_turn_started_at_ms: candidate.active_turn_started_at_ms,
          active_turn_elapsed_ms: candidate.active_turn_elapsed_ms,
          active_turn_slow: candidate.active_turn_slow,
          active_turn_slow_threshold_ms: candidate.active_turn_slow_threshold_ms,
          blocked_reason: candidate.blocked_reason,
          team_run_id: candidate.team_run_id,
        });
      }),
    );
    const activeRun =
      value.active_run === null ? null : this.#projectRunEvent(team, value.active_run, undefined);
    const projected = Object.freeze({
      experience: "standard" as const,
      session_generation: value.session_generation,
      active_run: activeRun,
      slot_work: slotWork,
    });
    try {
      assertAionUiTeamBridgeResponse(
        Object.freeze({ contractVersion: 1, status: 200, data: projected }),
      );
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run-state projection is invalid",
      );
    }
    if (
      projected.slot_work.some((work) => {
        const member = team.assistants.find(({ slot_id }) => slot_id === work.slot_id);
        return (
          member === undefined ||
          work.role !== (member.role === "leader" ? "lead" : "teammate") ||
          (activeRun !== null &&
            work.team_run_id !== null &&
            work.team_run_id !== activeRun.team_run_id)
        );
      })
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run state does not match durable Team authority",
      );
    }
    return projected as NativeAionUiStandardTeamRunState;
  }

  #projectRunEvent(
    team: NativeAionUiStandardTeam,
    value: unknown,
    expectedTargetSlotId: string | undefined,
  ): NativeAionUiStandardTeamRunEvent {
    if (!isRecord(value) || !Array.isArray(value.slot_work)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run projection is invalid",
      );
    }
    const slotWork = Object.freeze(
      value.slot_work.map((candidate) => {
        if (!isRecord(candidate)) {
          throw new AionUiTeamBridgePortError(
            "team-conflict",
            "The standard Team slot projection is invalid",
          );
        }
        return Object.freeze({
          slot_id: candidate.slot_id,
          role: candidate.role,
          state: candidate.state,
          queued_foreground_count: candidate.queued_foreground_count,
          queued_background_count: candidate.queued_background_count,
          active_turn_id: candidate.active_turn_id,
          active_turn_started_at_ms: candidate.active_turn_started_at_ms,
          active_turn_elapsed_ms: candidate.active_turn_elapsed_ms,
          active_turn_slow: candidate.active_turn_slow,
          active_turn_slow_threshold_ms: candidate.active_turn_slow_threshold_ms,
          blocked_reason: candidate.blocked_reason,
          team_run_id: candidate.team_run_id,
        });
      }),
    );
    const projected = Object.freeze({
      team_id: value.team_id,
      team_run_id: value.team_run_id,
      source: value.source,
      has_user_intervention: value.has_user_intervention,
      target_slot_id: value.target_slot_id,
      target_role: value.target_role,
      status: value.status,
      queued_intent_count: value.queued_intent_count,
      starting_batch_count: value.starting_batch_count,
      running_batch_count: value.running_batch_count,
      active_enqueue_lease_count: value.active_enqueue_lease_count,
      slot_work: slotWork,
    });
    try {
      assertNativeAionUiStandardTeamRunEvent(projected);
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run projection is invalid",
      );
    }
    const target = team.assistants.find(({ slot_id }) => slot_id === projected.target_slot_id);
    if (
      projected.team_id !== team.id ||
      (expectedTargetSlotId !== undefined && projected.target_slot_id !== expectedTargetSlotId) ||
      target === undefined ||
      projected.target_role !== (target.role === "leader" ? "lead" : "teammate") ||
      projected.slot_work.some((work) => {
        const member = team.assistants.find(({ slot_id }) => slot_id === work.slot_id);
        return (
          member === undefined ||
          work.role !== (member.role === "leader" ? "lead" : "teammate") ||
          (work.team_run_id !== null && work.team_run_id !== projected.team_run_id)
        );
      })
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The standard Team run does not match durable Team authority",
      );
    }
    return projected as NativeAionUiStandardTeamRunEvent;
  }

  async #resolveMembers(members: readonly AionUiStandardTeamMemberIntent[]): Promise<
    readonly Readonly<{
      member: AionUiStandardTeamMemberIntent;
      model: string;
    }>[]
  > {
    const managedAgentsValue = await this.#backend.listManagedAgents();
    if (!Array.isArray(managedAgentsValue)) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The authoritative Team model catalog is unavailable",
      );
    }
    const runtimeCatalogDiscoveries = new Map<string, Promise<unknown>>();
    return Promise.all(
      members.map(async (member) => {
        const assistantValue = await this.#backend.getAssistant(member.assistantId);
        if (!isRecord(assistantValue)) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The selected Team assistant is unavailable",
          );
        }
        const projectedAssistantId = standardText(assistantValue.id, "Team assistant identity");
        if (
          projectedAssistantId !== member.assistantId ||
          assistantValue.team_selectable !== true
        ) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The selected Team assistant is not admitted",
          );
        }
        const engine = isRecord(assistantValue.engine) ? assistantValue.engine : null;
        const agentId = engine === null ? null : modelIdentifier(engine.agent_id);
        const managedAgent = managedAgentsValue.find(
          (candidate) => isRecord(candidate) && candidate.id === agentId,
        );
        if (
          agentId === null ||
          !isRecord(managedAgent) ||
          managedAgent.enabled === false ||
          managedAgent.installed === false ||
          managedAgent.status === "missing" ||
          managedAgent.status === "offline"
        ) {
          throw new AionUiTeamBridgePortError(
            "team-model-unavailable",
            "The selected Team runtime is unavailable",
          );
        }
        let discoveredCatalog: AionUiStandardModelCatalog | null = null;
        if (
          managedModelCatalog(managedAgent) === null &&
          modelIdentifier(managedAgent.agent_type) === "acp" &&
          modelIdentifier(managedAgent.backend) === "gemini" &&
          this.#backend.discoverAssistantModelCatalog !== undefined
        ) {
          let discovery = runtimeCatalogDiscoveries.get(agentId);
          if (discovery === undefined) {
            discovery = this.#backend.discoverAssistantModelCatalog(member.assistantId);
            runtimeCatalogDiscoveries.set(agentId, discovery);
          }
          const discovered = await discovery;
          discoveredCatalog = managedModelCatalog(discovered);
          if (discoveredCatalog === null) {
            throw new AionUiTeamBridgePortError(
              "team-model-unavailable",
              "The selected Team runtime exposed no authoritative model catalog",
            );
          }
        }
        return Object.freeze({
          member,
          model: resolveStandardTeamModel(
            assistantValue,
            managedAgent,
            member.requestedModel,
            discoveredCatalog,
          ),
        });
      }),
    );
  }

  #projectPersistedAssistant(
    resolved: Readonly<{
      member: AionUiStandardTeamMemberIntent;
      model: string;
    }>,
    value: unknown,
  ): NativeAionUiStandardTeamAssistant {
    if (!isRecord(value)) {
      throw new AionUiTeamBridgePortError("team-conflict", "The persisted Team member is invalid");
    }
    const role =
      value.role === "lead" || value.role === "leader"
        ? "leader"
        : value.role === "teammate"
          ? "teammate"
          : null;
    if (
      role === null ||
      role !== resolved.member.role ||
      value.assistant_id !== resolved.member.assistantId ||
      value.model !== resolved.model
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted Team member differs from the admitted model selection",
      );
    }
    const pending = Number(value.pending_confirmations ?? 0);
    if (!Number.isSafeInteger(pending) || pending < 0) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted Team permission count is invalid",
      );
    }
    return Object.freeze({
      slot_id: standardText(value.slot_id, "Team member slot"),
      conversation_id: standardText(value.conversation_id, "Team member conversation"),
      role,
      assistant_backend: standardText(
        value.assistant_backend ?? value.backend ?? value.agent_type,
        "Team member runtime",
      ),
      assistant_name: standardText(value.assistant_name ?? value.name, "Team member name"),
      status: standardStatus(value.status),
      assistant_id: resolved.member.assistantId,
      model: resolved.model,
      pending_confirmations: pending,
    });
  }

  #projectStoredAssistant(value: unknown): NativeAionUiStandardTeamAssistant {
    if (!isRecord(value)) {
      throw new AionUiTeamBridgePortError("team-conflict", "The persisted Team member is invalid");
    }
    const role =
      value.role === "lead" || value.role === "leader"
        ? "leader"
        : value.role === "teammate"
          ? "teammate"
          : null;
    const pending = Number(value.pending_confirmations ?? 0);
    if (role === null || !Number.isSafeInteger(pending) || pending < 0) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted Team member authority is invalid",
      );
    }
    return Object.freeze({
      slot_id: standardText(value.slot_id, "Team member slot"),
      conversation_id: standardText(value.conversation_id, "Team member conversation"),
      role,
      assistant_backend: standardText(
        value.assistant_backend ?? value.backend ?? value.agent_type,
        "Team member runtime",
      ),
      assistant_name: standardText(value.assistant_name ?? value.name, "Team member name"),
      status: standardStatus(value.status),
      assistant_id: standardText(value.assistant_id, "Team assistant identity"),
      model: standardText(value.model, "Team model identity", 512),
      pending_confirmations: pending,
    });
  }

  #projectStoredTeam(value: unknown): NativeAionUiStandardTeam {
    if (!isRecord(value) || !Array.isArray(value.assistants)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team projection is invalid",
      );
    }
    const assistants = Object.freeze(
      value.assistants.map((assistant) => this.#projectStoredAssistant(assistant)),
    );
    const leader = assistants.find(({ role }) => role === "leader");
    const createdAt = Number(value.created_at);
    const updatedAt = Number(value.updated_at);
    if (
      leader === undefined ||
      value.leader_assistant_id !== leader.slot_id ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < createdAt
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team authority is invalid",
      );
    }
    const sessionMode = Object.hasOwn(value, "session_mode")
      ? standardText(value.session_mode, "Team session mode", 128)
      : undefined;
    const projected = Object.freeze({
      id: standardText(value.id, "Team identity"),
      experience: "standard" as const,
      user_id:
        typeof value.user_id === "string"
          ? standardText(value.user_id, "Team user identity")
          : "system_default_user",
      name: standardText(value.name, "Team name", 256),
      workspace: standardText(value.workspace, "Team workspace", 4_096, true),
      workspace_mode:
        value.workspace_mode === "isolated" || value.workspace_mode === "shared"
          ? value.workspace_mode
          : "shared",
      leader_assistant_id: leader.slot_id,
      assistants,
      ...(sessionMode === undefined ? {} : { session_mode: sessionMode }),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    try {
      assertNativeAionUiStandardTeam(projected);
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team projection is invalid",
      );
    }
    return projected;
  }

  async #getExpectedTeam(teamIdValue: string): Promise<NativeAionUiStandardTeam> {
    const projected = this.#projectStoredTeam(await this.#backend.getTeam(teamIdValue));
    if (projected.id !== teamIdValue) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "AionCore substituted the requested standard Team identity",
      );
    }
    return projected;
  }

  #projectPersistedTeam(
    intent: Extract<AionUiTeamBridgeRoute, { kind: "create-standard" }>,
    resolvedMembers: readonly Readonly<{
      member: AionUiStandardTeamMemberIntent;
      model: string;
    }>[],
    value: unknown,
    expectedTeamId?: string,
  ): NativeAionUiStandardTeam {
    if (!isRecord(value) || !Array.isArray(value.assistants)) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team projection is invalid",
      );
    }
    const persistedWorkspace = typeof value.workspace === "string" ? value.workspace : null;
    if (
      (expectedTeamId !== undefined && value.id !== expectedTeamId) ||
      value.name !== intent.name ||
      persistedWorkspace === null ||
      (intent.workspace !== "" && persistedWorkspace !== intent.workspace) ||
      (Object.hasOwn(value, "user_id") && value.user_id !== intent.userId) ||
      (Object.hasOwn(value, "workspace_mode") && value.workspace_mode !== intent.workspaceMode) ||
      value.assistants.length !== resolvedMembers.length
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team differs from the admitted creation intent",
      );
    }
    const assistants = Object.freeze(
      value.assistants.map((candidate, index) =>
        this.#projectPersistedAssistant(resolvedMembers[index]!, candidate),
      ),
    );
    const leader = assistants.find(({ role }) => role === "leader");
    const createdAt = Number(value.created_at);
    const updatedAt = Number(value.updated_at);
    const sessionMode = Object.hasOwn(value, "session_mode")
      ? standardText(value.session_mode, "Team session mode", 128)
      : undefined;
    if (
      leader === undefined ||
      value.leader_assistant_id !== leader.slot_id ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < createdAt
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team authority is invalid",
      );
    }
    const projected = Object.freeze({
      id: standardText(value.id, "Team identity"),
      experience: "standard",
      user_id: intent.userId,
      name: intent.name,
      workspace: persistedWorkspace,
      workspace_mode: intent.workspaceMode,
      leader_assistant_id: leader.slot_id,
      assistants,
      ...(sessionMode === undefined ? {} : { session_mode: sessionMode }),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    try {
      assertNativeAionUiStandardTeam(projected);
    } catch {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The persisted standard Team projection is invalid",
      );
    }
    return projected;
  }
}

function nextInstant(requested: Instant, previous: Instant): Instant {
  if (compareInstants(requested, previous) > 0) return requested;
  return instant(new Date(Date.parse(previous) + 1).toISOString());
}

function toMillis(value: Instant): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AionUiTeamBridgePortError("team-execution-failed", "Team time is invalid");
  }
  return parsed;
}

function conversationId(team: TeamDefinition, member: TeamMember): string {
  return `actestra-team-conversation-${digest(`${team.teamId}:${member.memberId}`)}`;
}

function assistantId(member: TeamMember): NativeAionUiTeamAssistant["assistant_id"] {
  return member.capability === "general" ? "actestra-general-worker" : "actestra-goose-worker";
}

function actionId(nodeId: TeamPlanNodeId): string {
  return `team-action-${digest(nodeId)}`;
}

function teamMessageId(snapshot: TeamRunSnapshot, content: string): string {
  return `team-message-${digest(`${snapshot.runId}:${snapshot.planId}:${content}`)}`;
}

function assignedMember(team: TeamDefinition, node: TeamRunNode): TeamMember {
  const member =
    node.kind === "human-feedback"
      ? team.members.find(({ role }) => role === "leader")
      : team.members.find(({ capability }) => capability === node.capability);
  if (member === undefined) {
    throw new AionUiTeamBridgePortError(
      "team-execution-failed",
      "Team run node has no authoritative member",
    );
  }
  return member;
}

function nodeState(node: TeamRunNode): NativeAionUiTeamNodeView["state"] {
  switch (node.status) {
    case "pending":
      return "queued";
    case "approval-blocked":
      return "blocked";
    case "handoff-required":
      return "handoff-required";
    case "revision-requested":
      return "revision-requested";
    default:
      return node.status;
  }
}

function nodeActions(node: TeamRunNode): NativeAionUiTeamNodeView["next_actions"] {
  switch (node.status) {
    case "running":
      return Object.freeze(["pause", "cancel", "replace", "handoff"]);
    case "approval-blocked":
      // approve/deny here mean the protected-Approval route, which Core admits only for Worker
      // nodes. A workflow-feedback node resolves through the run feedback route instead.
      return node.blockedReason === "human-feedback"
        ? Object.freeze([])
        : Object.freeze(["approve", "deny", "cancel"]);
    case "paused":
      return Object.freeze(["resume", "cancel", "replace", "handoff"]);
    case "revision-requested":
      // A denied feedback node becomes revision-requested. The leader can request revision,
      // which moves it back to approval-blocked for re-work. Child cancellation is Worker-only.
      return node.kind === "human-feedback" ? Object.freeze(["revise"]) : Object.freeze([]);
    case "failed":
      // Retry is the only active route for a failed Worker. Replace and handoff require
      // an active in-memory Worker attempt and therefore must not be projected here. Core also
      // rejects cancel once the attempt is terminal, so exposing it would create a dead button.
      return node.kind === "human-feedback" ? Object.freeze([]) : Object.freeze(["retry"]);
    case "pending":
    case "ready":
    case "handoff-required":
      return Object.freeze([]);
    default:
      return Object.freeze([]);
  }
}

function artifactReference(
  artifact: TeamRunNode["artifacts"][number],
  label: string,
  deliveries?: ReadonlyMap<string, NativeAionUiTeamArtifactDelivery>,
): NativeAionUiTeamArtifactReference {
  const delivery = deliveries?.get(artifact.artifactId);
  return Object.freeze({
    artifact_id: artifact.artifactId,
    kind: artifact.kind,
    label,
    ...(delivery === undefined ? {} : { delivery }),
  });
}

function projectNode(
  team: TeamDefinition,
  node: TeamRunNode,
  deliveries?: ReadonlyMap<string, NativeAionUiTeamArtifactDelivery>,
): NativeAionUiTeamNodeView {
  const member = assignedMember(team, node);
  return Object.freeze({
    action_id: actionId(node.nodeId),
    slot_id: member.memberId,
    title: node.title,
    capability: node.kind === "human-feedback" ? "feedback" : node.capability,
    state: nodeState(node),
    depends_on_action_ids: Object.freeze(node.dependsOn.map(actionId)),
    blocked_reason: node.blockedReason,
    blocked_explanation: node.blockedExplanation,
    current_executor:
      node.kind === "human-feedback"
        ? "User"
        : node.capability === "general"
          ? "General Worker"
          : "Goose",
    next_actions: nodeActions(node),
    artifacts: Object.freeze(
      node.artifacts.map((artifact) => artifactReference(artifact, node.title, deliveries)),
    ),
  });
}

function slotBlockedReason(
  node: TeamRunNode | undefined,
): NativeAionUiTeamSlotWork["blocked_reason"] {
  switch (node?.blockedReason) {
    case "human-feedback":
      return "human_feedback";
    case "protected-approval":
      return "protected_approval";
    case "attempt-failed":
      return "attempt_failed";
    default:
      return node?.blockedReason ?? null;
  }
}

function slotState(node: TeamRunNode | undefined): NativeAionUiTeamSlotWork["state"] {
  switch (node?.status) {
    case "pending":
      return "queued";
    case "ready":
      return "starting";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "approval-blocked":
    case "revision-requested":
    case "handoff-required":
    case "failed":
      return "blocked";
    default:
      return "idle";
  }
}

function relevantNode(
  team: TeamDefinition,
  snapshot: TeamRunSnapshot | null,
  member: TeamMember,
): TeamRunNode | undefined {
  if (snapshot === null) return undefined;
  const matching = snapshot.nodes.filter((node) =>
    node.kind === "human-feedback"
      ? member.role === "leader"
      : node.capability === member.capability,
  );
  return (
    matching.find(({ status }) =>
      [
        "approval-blocked",
        "revision-requested",
        "paused",
        "handoff-required",
        "running",
        "ready",
        "failed",
      ].includes(status),
    ) ?? matching.at(-1)
  );
}

function projectSlot(
  team: TeamDefinition,
  snapshot: TeamRunSnapshot | null,
  member: TeamMember,
): NativeAionUiTeamSlotWork {
  const node = relevantNode(team, snapshot, member);
  const attempt = node?.attempts.at(-1);
  const active =
    node !== undefined &&
    ["running", "approval-blocked", "paused", "handoff-required"].includes(node.status);
  const startedAtMs = active && attempt !== undefined ? toMillis(attempt.startedAt) : null;
  const updatedAtMs = snapshot === null ? null : toMillis(snapshot.updatedAt);
  return Object.freeze({
    slot_id: member.memberId,
    role: member.role === "leader" ? "lead" : "teammate",
    state: slotState(node),
    queued_foreground_count: node?.status === "pending" || node?.status === "ready" ? 1 : 0,
    queued_background_count: 0,
    active_turn_id: active && node !== undefined ? `team-turn-${digest(node.nodeId)}` : null,
    active_turn_started_at_ms: startedAtMs,
    active_turn_elapsed_ms:
      startedAtMs === null || updatedAtMs === null ? null : Math.max(0, updatedAtMs - startedAtMs),
    active_turn_slow: active ? false : null,
    active_turn_slow_threshold_ms: active ? 30_000 : null,
    blocked_reason: slotBlockedReason(node),
    team_run_id: snapshot?.runId ?? null,
  });
}

function projectAssistant(
  team: TeamDefinition,
  snapshot: TeamRunSnapshot | null,
  member: TeamMember,
): NativeAionUiTeamAssistant {
  const node = relevantNode(team, snapshot, member);
  let status: NativeAionUiTeamAssistant["status"] = "idle";
  if (node !== undefined) {
    if (["running", "approval-blocked", "paused", "handoff-required"].includes(node.status)) {
      status = "active";
    } else if (node.status === "completed") {
      status = "completed";
    } else if (node.status === "failed") {
      status = "failed";
    } else if (node.status === "pending" || node.status === "ready") {
      status = "pending";
    }
  }
  return Object.freeze({
    slot_id: member.memberId,
    conversation_id: conversationId(team, member),
    role: member.role,
    assistant_backend: member.capability === "general" ? "general" : "goose",
    assistant_name: member.displayName,
    status,
    assistant_id: assistantId(member),
    model: "default",
    pending_confirmations: node?.status === "approval-blocked" ? 1 : 0,
  });
}

function projectNativeTeam(
  team: TeamDefinition,
  snapshot: TeamRunSnapshot | null,
): NativeAionUiTeam {
  const leader = team.members.find(({ role }) => role === "leader");
  if (leader === undefined) {
    throw new AionUiTeamBridgePortError("team-execution-failed", "Team leader is missing");
  }
  const projected = Object.freeze({
    id: team.teamId,
    experience: "orchestrated" as const,
    user_id: ACTESTRA_TEAM_LOCAL_USER_ID,
    name: team.name,
    description: team.description,
    workspace: team.workspaceId,
    workspace_mode: "isolated" as const,
    leader_assistant_id: leader.memberId,
    assistants: Object.freeze(
      team.members.map((member) => projectAssistant(team, snapshot, member)),
    ),
    session_mode: "plan" as const,
    created_at: toMillis(team.createdAt),
    updated_at: toMillis(team.updatedAt),
  });
  assertNativeAionUiTeam(projected);
  return projected;
}

function runStatus(snapshot: TeamRunSnapshot): NativeAionUiTeamRunEvent["status"] {
  switch (snapshot.status) {
    case "accepted":
      return "accepted";
    case "completed":
    case "failed":
    case "cancelled":
      return snapshot.status;
    default:
      return "running";
  }
}

function statusExplanation(snapshot: TeamRunSnapshot): string {
  if (snapshot.statusExplanation !== null) return snapshot.statusExplanation;
  switch (snapshot.status) {
    case "accepted":
      return "Actestra Core admitted the Team plan and is ready to start its Workers.";
    case "running":
      return "Actestra Core is coordinating the current General and Goose work.";
    case "paused":
      return "One or more Team Workers are paused and can be resumed or replaced.";
    case "blocked":
      return "The Team is blocked; review the node reason and next valid action.";
    case "completed":
      return "Actestra Core completed the Team and preserved its result Artifacts.";
    case "failed":
      return "The Team stopped after a Worker or aggregation failure.";
    case "cancelled":
      return "Actestra Core cancelled the whole Team and requested Worker cleanup.";
  }
}

function projectRunEvent(
  team: TeamDefinition,
  snapshot: TeamRunSnapshot,
  source: NativeAionUiTeamRunEvent["source"],
  deliveries?: ReadonlyMap<string, NativeAionUiTeamArtifactDelivery>,
): NativeAionUiTeamRunEvent {
  const leader = team.members.find(({ role }) => role === "leader");
  if (leader === undefined) {
    throw new AionUiTeamBridgePortError("team-execution-failed", "Team leader is missing");
  }
  const activeStatuses = new Set(["running", "approval-blocked", "paused", "handoff-required"]);
  const projected: unknown = Object.freeze({
    team_id: snapshot.teamId,
    team_run_id: snapshot.runId,
    source,
    has_user_intervention: snapshot.nodes.some(
      (node) => node.kind === "human-feedback" || node.status === "approval-blocked",
    ),
    target_slot_id: leader.memberId,
    target_role: "lead",
    status: runStatus(snapshot),
    queued_intent_count: snapshot.nodes.filter(({ status }) => status === "pending").length,
    starting_batch_count: snapshot.nodes.filter(({ status }) => status === "ready").length,
    running_batch_count: snapshot.nodes.filter(({ status }) => activeStatuses.has(status)).length,
    active_enqueue_lease_count: TERMINAL_RUN_STATUSES.has(snapshot.status) ? 0 : 1,
    slot_work: Object.freeze(team.members.map((member) => projectSlot(team, snapshot, member))),
    actestra: Object.freeze({
      authority: "Actestra Core",
      authority_source: "schema-15-team-run",
      revision: snapshot.revision,
      core_status: snapshot.status,
      status_explanation: statusExplanation(snapshot),
      nodes: Object.freeze(snapshot.nodes.map((node) => projectNode(team, node, deliveries))),
      result:
        snapshot.result === null
          ? null
          : Object.freeze({
              summary: snapshot.result.summary,
              artifacts: Object.freeze(
                snapshot.result.artifacts.map((artifact) =>
                  artifactReference(artifact, "Team result Artifact", deliveries),
                ),
              ),
            }),
    }),
  });
  assertNativeAionUiTeamRunEvent(projected);
  return projected;
}

function eventType(snapshot: TeamRunSnapshot): AionUiTeamEvent["type"] {
  switch (snapshot.status) {
    case "accepted":
      return "team.runAccepted";
    case "completed":
      return "team.runCompleted";
    case "cancelled":
      return "team.runCancelled";
    case "failed":
      return "team.runFailed";
    default:
      return "team.runUpdated";
  }
}

function normalizedFailure(error: unknown): AionUiTeamBridgePortError {
  if (error instanceof AionUiTeamBridgePortError) return error;
  if (error instanceof TeamPlanAdmissionServiceError) {
    const code =
      error.code === "planner-invalid"
        ? "team-planner-invalid"
        : error.code === "planner-timeout"
          ? "team-planner-timeout"
          : error.code === "planner-failed"
            ? "team-planner-unavailable"
            : "team-execution-failed";
    return new AionUiTeamBridgePortError(code, "Team plan admission failed");
  }
  if (error instanceof TeamOrchestratorServiceError) {
    if (error.code === "not-found") {
      return new AionUiTeamBridgePortError("team-not-found", "Team run not found");
    }
    if (error.code === "closed") {
      return new AionUiTeamBridgePortError("team-unavailable", "Team orchestrator is closed");
    }
    return new AionUiTeamBridgePortError("team-execution-failed", "Team orchestration failed");
  }
  if (error instanceof PersistenceError) {
    if (
      error.code === "team-experience-conflict" ||
      error.code === "team-definition-conflict" ||
      error.code === "team-run-conflict" ||
      error.code === "team-message-delivery-conflict"
    ) {
      return new AionUiTeamBridgePortError("team-conflict", "Team authority changed");
    }
    if (error.code === "closed") {
      return new AionUiTeamBridgePortError("team-unavailable", "Team persistence is closed");
    }
  }
  return new AionUiTeamBridgePortError("team-execution-failed", "Team operation failed");
}

export class AionUiTeamService implements AionUiTeamBridgePort {
  readonly #persistence: AionUiTeamPersistencePort;
  readonly #admission: AionUiTeamAdmissionPort | null;
  readonly #initialOrchestrator: AionUiTeamOrchestratorPort | null;
  readonly #workerRuntimeAdmission: AionUiTeamWorkerRuntimeAdmissionPort | null;
  readonly #modelCatalog: AionUiTeamModelCatalogPort | null;
  readonly #workspaceSelection: AionUiTeamWorkspaceSelectionPort | null;
  readonly #standardTeamCreation: AionUiStandardTeamCreationPort | null;
  readonly #now: () => Instant;
  readonly #createDigest: () => string;
  readonly #handlers = new Set<(event: AionUiTeamEvent) => void>();
  readonly #orchestratorSubscriptions = new Map<AionUiTeamOrchestratorPort, () => void>();
  /** Serializes the Main-owned persistence half of one manual handoff node. */
  readonly #handoffMutations = new Map<string, Promise<void>>();
  #closed = false;

  constructor(options: AionUiTeamServiceOptions) {
    this.#persistence = options.persistence;
    this.#admission = options.admission;
    this.#initialOrchestrator = options.orchestrator;
    this.#workerRuntimeAdmission = options.workerRuntimeAdmission ?? null;
    this.#modelCatalog = options.modelCatalog ?? null;
    this.#workspaceSelection = options.workspaceSelection ?? null;
    this.#standardTeamCreation = options.standardTeamCreation ?? null;
    this.#now = options.now;
    this.#createDigest = options.createDigest;
    instant(this.#now());
    if (this.#initialOrchestrator !== null) {
      this.#subscribeOrchestrator(this.#initialOrchestrator);
    }
  }

  async dispatch(route: AionUiTeamBridgeRoute): Promise<AionUiTeamBridgeSuccessData> {
    if (this.#closed) {
      throw new AionUiTeamBridgePortError("team-unavailable", "Team service is closed");
    }
    try {
      return await this.#dispatch(route);
    } catch (error) {
      throw normalizedFailure(error);
    }
  }

  async recoverStandardTeamMessageDeliveries(): Promise<number> {
    if (this.#closed) {
      throw new AionUiTeamBridgePortError("team-unavailable", "Team service is closed");
    }
    const unresolved = await this.#persistence.listUnresolvedStandardTeamMessageDeliveries(100);
    let recovered = 0;
    for (const delivery of unresolved) {
      if (delivery.state !== "pending-effect") continue;
      const result = await this.#persistence.persistStandardTeamMessageDelivery(
        normalizeStandardTeamMessageDelivery({
          ...delivery,
          state: "effect-uncertain",
          updatedAt: this.#now(),
        }),
      );
      if (result.status === "stored") recovered += 1;
    }
    return recovered;
  }

  subscribe(handler: (event: AionUiTeamEvent) => void): () => void {
    if (this.#closed) return (): void => {};
    this.#handlers.add(handler);
    return (): void => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsubscribe of this.#orchestratorSubscriptions.values()) unsubscribe();
    this.#orchestratorSubscriptions.clear();
    this.#handlers.clear();
  }

  #subscribeOrchestrator(orchestrator: AionUiTeamOrchestratorPort): void {
    if (this.#orchestratorSubscriptions.has(orchestrator)) return;
    this.#orchestratorSubscriptions.set(
      orchestrator,
      orchestrator.subscribe((snapshot) => {
        void this.#emitSnapshot(snapshot);
      }),
    );
  }

  async #ensureWorkerRuntime(team: TeamDefinition): Promise<AionUiTeamOrchestratorPort> {
    let orchestrator = this.#initialOrchestrator;
    if (this.#workerRuntimeAdmission !== null) {
      try {
        orchestrator = await this.#workerRuntimeAdmission.admit(team);
      } catch {
        orchestrator = null;
      }
    }
    if (orchestrator === null) {
      throw new AionUiTeamBridgePortError(
        "team-worker-runtime-unavailable",
        "The selected Team Worker runtime is unavailable",
      );
    }
    this.#subscribeOrchestrator(orchestrator);
    return orchestrator;
  }

  async #dispatch(route: AionUiTeamBridgeRoute): Promise<AionUiTeamBridgeSuccessData> {
    switch (route.kind) {
      case "list":
        return this.#list();
      case "model-options":
        return this.#listModelOptions();
      case "get-model-selection":
        return this.#getModelSelection(route.teamId);
      case "update-model-selection":
        return this.#updateModelSelection(route.teamId, route.modelSelection);
      case "list-workspaces":
        return this.#listWorkspaces();
      case "select-workspace":
        return this.#selectWorkspace();
      case "create":
        return this.#create(
          route.name,
          route.description,
          route.workspaceId,
          route.modelSelection,
          route.members,
        );
      case "create-standard":
        if (this.#standardTeamCreation === null) {
          throw new AionUiTeamBridgePortError(
            "team-unavailable",
            "Standard Team creation is unavailable",
          );
        }
        return this.#createStandardTeam(route);
      case "add-standard-member":
        if (this.#standardTeamCreation === null) {
          throw new AionUiTeamBridgePortError(
            "team-unavailable",
            "Standard Team member creation is unavailable",
          );
        }
        await this.#requireExperience(route.teamId, "standard");
        return this.#standardTeamCreation.addMember(route);
      case "get":
        return this.#get(route.teamId);
      case "remove":
        return this.#remove(route.teamId);
      case "add-member":
        return this.#addMember(route.teamId, route.member);
      case "remove-member":
        await this.#removeMember(route.teamId, route.slotId);
        return null;
      case "rename-member":
        return this.#renameMember(route.teamId, route.slotId, route.name);
      case "rename-team":
        return this.#renameTeam(route.teamId, route.name);
      case "active-lease":
        return this.#renewActiveLease(route.teamId);
      case "run-state":
        return this.#runState(route.teamId);
      case "ensure-session":
        return this.#ensureSession(route.teamId);
      case "stop-session":
        return this.#stopSession(route.teamId);
      case "set-session-mode":
        return this.#setSessionMode(route);
      case "config-options":
        if (this.#standardTeamCreation === null) {
          throw new AionUiTeamBridgePortError(
            "team-unavailable",
            "Standard Team model reconciliation is unavailable",
          );
        }
        await this.#requireExperience(route.teamId, "standard");
        return this.#standardTeamCreation.loadConfigOptions(route.teamId, route.conversationId);
      case "set-config-option":
        if (this.#standardTeamCreation === null) {
          throw new AionUiTeamBridgePortError(
            "team-unavailable",
            "Standard Team config changes are unavailable",
          );
        }
        await this.#requireExperience(route.teamId, "standard");
        return this.#standardTeamCreation.setConfigOption(
          route.teamId,
          route.conversationId,
          route.optionId,
          route.value,
        );
      case "attach-member":
        return this.#attachMember(route.teamId, route.slotId);
      case "send-member-message":
        return this.#sendMemberMessage(
          route.teamId,
          route.slotId,
          route.content,
          route.files,
          route.requestNonce,
        );
      case "send-message":
        return this.#sendMessage(route.teamId, route.content, route.files, route.requestNonce);
      case "cancel-run":
        return this.#cancelRun(route.teamId, route.runId, route.reason);
      case "cancel-node":
      case "pause-node":
      case "resume-node":
      case "retry-node":
      case "replace-node":
      case "handoff-node":
      case "revise-node":
        return this.#controlNode(route);
      case "decide-approval":
        return this.#decideApproval(route.teamId, route.runId, route.slotId, route.decision);
      case "resolve-feedback":
        return this.#resolveFeedback(route.teamId, route.runId, route.decision, route.note);
      case "complete-handoff":
        return this.#completeHandoff(route);
    }
  }

  async #list(): Promise<readonly (NativeAionUiTeam | NativeAionUiStandardTeam)[]> {
    const teams = await this.#persistence.listTeamDefinitions(100);
    const orchestrated = await Promise.all(
      teams.map(async (team) => {
        await this.#bindExperience(team.teamId, "orchestrated");
        return this.#nativeTeam(team);
      }),
    );
    const standard =
      this.#standardTeamCreation === null ? [] : await this.#standardTeamCreation.list();
    for (const team of standard) await this.#bindExperience(team.id, "standard");
    const identities = [...standard, ...orchestrated].map(({ id }) => id);
    if (new Set(identities).size !== identities.length) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "A Team identity exists in more than one authority store",
      );
    }
    return Object.freeze([...standard, ...orchestrated]);
  }

  async #createStandardTeam(
    route: Extract<AionUiTeamBridgeRoute, { kind: "create-standard" }>,
  ): Promise<NativeAionUiStandardTeam> {
    if (this.#standardTeamCreation === null) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Standard Team creation is unavailable",
      );
    }
    if (route.userId !== "system_default_user") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Standard Team user authority is not Main-owned",
      );
    }
    if (route.workspace !== "") {
      const graph = await this.#persistence.loadDomainGraph();
      let admitted = false;
      for (const workspace of graph.workspaces) {
        if (workspace.state !== "active") continue;
        const grant = await this.#persistence.getActiveWorkspaceGrant(workspace.id);
        if (grant !== null && grant.state === "active" && grant.rootPath === route.workspace) {
          admitted = true;
          break;
        }
      }
      if (!admitted) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "Standard Team workspace is not covered by an active Main-owned grant",
        );
      }
    }
    const team = await this.#standardTeamCreation.create(route);
    try {
      await this.#bindExperience(team.id, "standard");
    } catch (error) {
      try {
        await this.#standardTeamCreation.remove(team.id);
      } catch {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The standard Team authority conflict could not be compensated",
        );
      }
      throw error;
    }
    return team;
  }

  async #get(teamIdValue: string): Promise<NativeAionUiTeam | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const existing = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (existing?.experience === "orchestrated") {
      return this.#nativeTeam(await this.#requireTeam(stableTeamId));
    }
    if (existing?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.get(stableTeamId);
    }

    let orchestratedId: ReturnType<typeof teamId> | null = null;
    try {
      orchestratedId = teamId(stableTeamId);
    } catch {
      // A native AionUI Team identity need not use Actestra's orchestrated digest shape.
    }
    if (orchestratedId !== null) {
      const orchestrated = await this.#persistence.getTeamDefinition(orchestratedId);
      if (orchestrated !== null) {
        await this.#bindExperience(stableTeamId, "orchestrated");
        return this.#nativeTeam(orchestrated);
      }
    }
    if (this.#standardTeamCreation === null) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team does not exist");
    }
    const standard = await this.#standardTeamCreation.get(stableTeamId);
    await this.#bindExperience(standard.id, "standard");
    return standard;
  }

  async #setSessionMode(
    route: Extract<AionUiTeamBridgeRoute, { kind: "set-session-mode" }>,
  ): Promise<NativeAionUiTeam | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(route.teamId);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.setSessionMode(
        stableTeamId,
        route.conversationId,
        route.mode,
      );
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#nativeTeam(await this.#requireTeam(stableTeamId));
    const leader = team.assistants.find(({ slot_id }) => slot_id === team.leader_assistant_id);
    if (route.mode !== "plan" || leader?.conversation_id !== route.conversationId) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Orchestrated Team mode is fixed by Actestra Core",
      );
    }
    return team;
  }

  async #requireExperience(
    teamIdValue: string,
    expected: "standard" | "orchestrated",
  ): Promise<void> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding === null || binding.experience !== expected) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
  }

  async #bindExperience(
    teamIdValue: string,
    experience: "standard" | "orchestrated",
  ): Promise<void> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const existing = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (existing !== null) {
      if (existing.experience !== experience) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "Team experience conflicts with durable authority",
        );
      }
      return;
    }
    const result = await this.#persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stableTeamId,
        experience,
        boundAt: instant(this.#now()),
      }),
    );
    if (result.binding.teamId !== stableTeamId || result.binding.experience !== experience) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience persistence returned substituted authority",
      );
    }
  }

  async #listModelOptions(): Promise<NativeAionUiTeamModelOptions> {
    if (this.#modelCatalog === null) {
      throw new AionUiTeamBridgePortError(
        "team-worker-runtime-unavailable",
        "Team model options are unavailable",
      );
    }
    let options: NativeAionUiTeamModelOptions | null;
    try {
      options = snapshotTeamModelOptions(await this.#modelCatalog.list());
    } catch {
      options = null;
    }
    if (options === null) {
      throw new AionUiTeamBridgePortError(
        "team-worker-runtime-unavailable",
        "Team model options are unavailable",
      );
    }
    return options;
  }

  async #assertModelSelectionAvailable(selection: TeamModelSelection): Promise<void> {
    const options = await this.#listModelOptions();
    const matches = options.providers.filter(
      (provider) =>
        provider.provider_id === selection.providerId &&
        provider.model_ids.includes(selection.modelId),
    );
    if (matches.length !== 1) {
      throw new AionUiTeamBridgePortError(
        "team-worker-runtime-unavailable",
        "The selected Team model is unavailable",
      );
    }
  }

  async #getModelSelection(teamIdValue: string): Promise<NativeAionUiTeamModelSelection> {
    const team = await this.#requireTeam(teamIdValue);
    if (team.modelSelection === undefined) {
      throw new AionUiTeamBridgePortError(
        "team-model-unavailable",
        "The Team has no explicit model selection",
      );
    }
    return this.#projectModelSelection(team.modelSelection);
  }

  async #updateModelSelection(
    teamIdValue: string,
    modelSelection: TeamModelSelection,
  ): Promise<NativeAionUiTeamModelSelection> {
    const team = await this.#requireTeam(teamIdValue);
    const latestRun = await this.#latestRun(team.teamId);
    if (latestRun !== null && !["completed", "failed", "cancelled"].includes(latestRun.status)) {
      throw new AionUiTeamBridgePortError(
        "team-active",
        "Team model selection cannot change while a Team run is active",
      );
    }
    await this.#assertModelSelectionAvailable(modelSelection);
    if (
      team.modelSelection?.providerId === modelSelection.providerId &&
      team.modelSelection.modelId === modelSelection.modelId
    ) {
      return this.#projectModelSelection(modelSelection);
    }
    const replacement = normalizeTeamDefinition({
      ...team,
      modelSelection,
      updatedAt: this.#nextUpdate(team),
    });
    const result = await this.#persistence.replaceTeamDefinition(team, replacement);
    if (
      result.team.modelSelection?.providerId !== modelSelection.providerId ||
      result.team.modelSelection.modelId !== modelSelection.modelId
    ) {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team model selection persistence returned substituted authority",
      );
    }
    return this.#projectModelSelection(result.team.modelSelection);
  }

  #projectModelSelection(selection: TeamModelSelection): NativeAionUiTeamModelSelection {
    return Object.freeze({
      provider_id: selection.providerId,
      model_id: selection.modelId,
    });
  }

  async #listWorkspaces(): Promise<NativeAionUiTeamWorkspaceOptions> {
    const graph = await this.#persistence.loadDomainGraph();
    const options: Array<{ workspace_id: string; display_name: string }> = [];
    for (const workspace of graph.workspaces) {
      if (workspace.state !== "active") continue;
      const grant = await this.#persistence.getActiveWorkspaceGrant(workspace.id);
      if (grant === null || grant.state !== "active") continue;
      options.push({
        workspace_id: workspace.id,
        display_name: workspace.name,
      });
    }
    return Object.freeze({
      workspace_options: Object.freeze(options),
    });
  }

  async #selectWorkspace(): Promise<NativeAionUiTeamWorkspaceOption | null> {
    if (this.#workspaceSelection === null) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Team workspace selection is unavailable",
      );
    }
    const selected = await this.#workspaceSelection.select();
    if (selected === null) return null;

    const selectedAt = instant(this.#now());
    const identityDigest = digest(`actestra-team-workspace\u0000${selected.rootPath}`);
    const stableWorkspaceId = workspaceId(`workspace-team-${identityDigest}`);
    const stableGrantId = workspaceGrantId(`grant-team-${identityDigest}`);
    const graph = await this.#persistence.loadDomainGraph();
    const existingWorkspace = graph.workspaces.find(
      (candidate) => candidate.id === stableWorkspaceId,
    );
    const existingGrant = await this.#persistence.getActiveWorkspaceGrant(stableWorkspaceId);
    if (existingGrant !== null) {
      if (existingGrant.rootPath !== selected.rootPath) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "Team workspace identity conflicts with an existing grant",
        );
      }
      return Object.freeze({
        workspace_id: stableWorkspaceId,
        display_name: existingWorkspace?.name ?? existingGrant.displayName,
      });
    }

    const workspace = Object.freeze({
      id: stableWorkspaceId,
      name: selected.displayName,
      state: "active" as const,
      createdAt: existingWorkspace?.createdAt ?? selectedAt,
      updatedAt: selectedAt,
    });
    await this.#persistence.replaceDomainGraph({
      ...graph,
      workspaces: Object.freeze([
        ...graph.workspaces.filter((candidate) => candidate.id !== stableWorkspaceId),
        workspace,
      ]),
    });
    await this.#persistence.persistWorkspaceGrant({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: stableGrantId,
      workspaceId: stableWorkspaceId,
      rootPath: selected.rootPath,
      displayName: selected.displayName,
      state: "active",
      createdAt: selectedAt,
      updatedAt: selectedAt,
    });
    return Object.freeze({
      workspace_id: stableWorkspaceId,
      display_name: selected.displayName,
    });
  }

  async #create(
    name: string,
    description: string | null,
    workspaceId: string,
    modelSelection: TeamModelSelection,
    members: readonly AionUiTeamMemberInput[],
  ): Promise<NativeAionUiTeam> {
    await this.#assertModelSelectionAvailable(modelSelection);
    const createdAt = instant(this.#now());
    const rawDigest = this.#createDigest();
    if (!/^[a-f0-9]{64}$/u.test(rawDigest)) {
      throw new AionUiTeamBridgePortError("team-execution-failed", "Team identity source failed");
    }
    const stableTeamId = teamId(`team-${rawDigest}`);
    const team = normalizeTeamDefinition({
      contractVersion: 1,
      experience: "orchestrated",
      teamId: stableTeamId,
      name,
      description,
      workspaceId,
      modelSelection,
      members: members.map((member, index) => ({
        memberId: `team-member-${digest(`${stableTeamId}:${String(index)}:${member.capability}`)}`,
        role: member.role,
        capability: member.capability,
        displayName: member.displayName,
      })),
      createdAt,
      updatedAt: createdAt,
    });
    const stored = await this.#persistence.persistTeamDefinition(team);
    try {
      await this.#bindExperience(stored.team.teamId, "orchestrated");
    } catch (error) {
      await this.#persistence.removeTeamDefinition(stored.team, this.#nextUpdate(stored.team));
      throw error;
    }
    const native = await this.#nativeTeam(stored.team);
    this.#emit({
      type: "team.created",
      payload: { team_id: team.teamId, team_name: team.name },
    });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "created" },
    });
    return native;
  }

  async #remove(teamIdValue: string): Promise<null> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      await this.#standardTeamCreation.remove(stableTeamId);
      this.#emit({ type: "team.removed", payload: { team_id: stableTeamId } });
      this.#emit({
        type: "team.listChanged",
        payload: { team_id: stableTeamId, action: "removed" },
      });
      return null;
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    await this.#assertNoActiveRun(team.teamId);
    await this.#persistence.removeTeamDefinition(team, this.#nextUpdate(team));
    this.#emit({ type: "team.removed", payload: { team_id: team.teamId } });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "removed" },
    });
    return null;
  }

  async #renameTeam(
    teamIdValue: string,
    name: string,
  ): Promise<NativeAionUiTeam | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.rename(stableTeamId, name);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const replacement = normalizeTeamDefinition({
      ...team,
      name,
      updatedAt: this.#nextUpdate(team),
    });
    const result = await this.#persistence.replaceTeamDefinition(team, replacement);
    this.#emit({
      type: "team.renamed",
      payload: { team_id: team.teamId, team_name: name },
    });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "renamed" },
    });
    return this.#nativeTeam(result.team);
  }

  async #addMember(
    teamIdValue: string,
    input: AionUiTeamMemberInput,
  ): Promise<NativeAionUiTeamAssistant> {
    const team = await this.#requireTeam(teamIdValue);
    const member = Object.freeze({
      memberId: teamMemberId(
        `team-member-${digest(`${team.teamId}:${team.updatedAt}:${String(team.members.length)}:${input.displayName}`)}`,
      ),
      role: input.role,
      capability: input.capability,
      displayName: input.displayName,
    });
    const replacement = normalizeTeamDefinition({
      ...team,
      members: [...team.members, member],
      updatedAt: this.#nextUpdate(team),
    });
    const result = await this.#persistence.replaceTeamDefinition(team, replacement);
    const assistant = projectAssistant(result.team, null, member);
    this.#emit({
      type: "team.agentSpawned",
      payload: { team_id: team.teamId, assistant },
    });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "agent_added" },
    });
    return assistant;
  }

  async #removeMember(teamIdValue: string, slotIdValue: string): Promise<void> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const boundedSlotId = standardText(slotIdValue, "Team member identity");
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      await this.#standardTeamCreation.removeMember(stableTeamId, boundedSlotId);
      this.#emit({
        type: "team.agentRemoved",
        payload: { team_id: stableTeamId, slot_id: boundedSlotId },
      });
      this.#emit({
        type: "team.listChanged",
        payload: { team_id: stableTeamId, action: "agent_removed" },
      });
      return;
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const stableSlotId = teamMemberId(boundedSlotId);
    const team = await this.#requireTeam(stableTeamId);
    if (!team.members.some(({ memberId }) => memberId === stableSlotId)) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const replacement = normalizeTeamDefinition({
      ...team,
      members: team.members.filter(({ memberId }) => memberId !== stableSlotId),
      updatedAt: this.#nextUpdate(team),
    });
    await this.#persistence.replaceTeamDefinition(team, replacement);
    this.#emit({
      type: "team.agentRemoved",
      payload: { team_id: team.teamId, slot_id: stableSlotId },
    });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "agent_removed" },
    });
  }

  async #renameMember(
    teamIdValue: string,
    slotIdValue: string,
    name: string,
  ): Promise<NativeAionUiTeamAssistant | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const boundedSlotId = standardText(slotIdValue, "Team member identity");
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      const observed = await this.#standardTeamCreation.renameMember(
        stableTeamId,
        boundedSlotId,
        name,
      );
      this.#emit({
        type: "team.agentRenamed",
        payload: { team_id: stableTeamId, slot_id: boundedSlotId, name },
      });
      return observed;
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const stableSlotId = teamMemberId(boundedSlotId);
    const team = await this.#requireTeam(stableTeamId);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const replacement = normalizeTeamDefinition({
      ...team,
      members: team.members.map((candidate) =>
        candidate.memberId === stableSlotId ? { ...candidate, displayName: name } : candidate,
      ),
      updatedAt: this.#nextUpdate(team),
    });
    const result = await this.#persistence.replaceTeamDefinition(team, replacement);
    const renamed = result.team.members.find(({ memberId }) => memberId === stableSlotId)!;
    const assistant = projectAssistant(result.team, null, renamed);
    this.#emit({
      type: "team.agentRenamed",
      payload: { team_id: team.teamId, slot_id: stableSlotId, name },
    });
    return assistant;
  }

  async #attachMember(
    teamIdValue: string,
    slotIdValue: string,
  ): Promise<NativeAionUiTeamAssistant | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.attachMember(stableTeamId, slotIdValue);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const stableSlotId = teamMemberId(slotIdValue);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const snapshot = await this.#latestRun(team.teamId);
    return projectAssistant(team, snapshot, member);
  }

  async #deliverStandardTeamMessage(
    input: Readonly<{
      teamId: string;
      targetSlotId: string | null;
      content: string;
      files: readonly string[];
      requestNonce: string;
      prepareEffect: () => Promise<AionUiPreparedStandardTeamMessageEffect>;
    }>,
  ): Promise<NativeAionUiStandardTeamRunAck> {
    if (this.#standardTeamCreation === null) {
      throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
    }
    const stableNonce = String(input.requestNonce);
    const deliveryId = `standard-team-delivery-${digest(
      `${input.teamId}\u0000${input.targetSlotId ?? ""}\u0000${stableNonce}`,
    )}`;
    const requestSha256 = digest(
      JSON.stringify([input.teamId, input.targetSlotId, input.content, [...input.files]]),
    );
    const existing = await this.#persistence.getStandardTeamMessageDelivery(deliveryId);
    if (existing !== null) {
      if (
        existing.teamId !== input.teamId ||
        existing.targetSlotId !== input.targetSlotId ||
        existing.clientRequestNonce !== stableNonce ||
        existing.requestSha256 !== requestSha256
      ) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The Standard Team message request nonce conflicts with durable authority",
        );
      }
      if (
        existing.state !== "effect-observed" ||
        existing.providerEnqueueStatus === null ||
        existing.providerMessageId === null ||
        existing.providerRunId === null
      ) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The previous Standard Team message outcome is uncertain; refresh Team state and do not resend it",
        );
      }
      const state = await this.#standardTeamCreation.getRunState(input.teamId);
      if (state.active_run?.team_run_id !== existing.providerRunId) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "The observed Standard Team message run is no longer available for safe replay",
        );
      }
      return Object.freeze({
        experience: "standard",
        enqueue_status: existing.providerEnqueueStatus,
        message_id: existing.providerMessageId,
        run: state.active_run,
      });
    }
    const effect = await input.prepareEffect();
    if (typeof effect !== "function") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The Standard Team message preflight returned no executable effect",
      );
    }
    const createdAt = this.#now();
    const pending = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId,
      clientRequestNonce: stableNonce,
      requestSha256,
      teamId: input.teamId,
      targetSlotId: input.targetSlotId,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt,
      updatedAt: createdAt,
    });
    const reservation = await this.#persistence.persistStandardTeamMessageDelivery(pending);
    if (reservation.status !== "stored") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "The Standard Team message intent is already being delivered",
      );
    }
    let acknowledgement: NativeAionUiStandardTeamRunAck;
    try {
      acknowledgement = await effect();
    } catch (error) {
      const uncertain = normalizeStandardTeamMessageDelivery({
        ...pending,
        state: "effect-uncertain",
        updatedAt: this.#now(),
      });
      try {
        await this.#persistence.persistStandardTeamMessageDelivery(uncertain);
      } catch (persistenceError) {
        throw new AggregateError(
          [error, persistenceError],
          "Standard Team provider effect and uncertainty persistence both failed",
        );
      }
      throw error;
    }
    const observed = normalizeStandardTeamMessageDelivery({
      ...pending,
      state: "effect-observed",
      providerEnqueueStatus: acknowledgement.enqueue_status,
      providerMessageId: acknowledgement.message_id,
      providerRunId: acknowledgement.run.team_run_id,
      updatedAt: this.#now(),
    });
    try {
      await this.#persistence.persistStandardTeamMessageDelivery(observed);
    } catch (error) {
      try {
        await this.#persistence.persistStandardTeamMessageDelivery(
          normalizeStandardTeamMessageDelivery({
            ...pending,
            state: "effect-uncertain",
            providerMessageId: acknowledgement.message_id,
            providerRunId: acknowledgement.run.team_run_id,
            updatedAt: observed.updatedAt,
          }),
        );
      } catch {
        // Preserve the first persistence failure as the authoritative error.
      }
      throw error;
    }
    return acknowledgement;
  }

  async #sendMemberMessage(
    teamIdValue: string,
    slotIdValue: string,
    content: string,
    files: readonly string[],
    requestNonce: string,
  ): Promise<null | NativeAionUiStandardTeamRunAck> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#deliverStandardTeamMessage({
        teamId: stableTeamId,
        targetSlotId: slotIdValue,
        content,
        files,
        requestNonce,
        prepareEffect: () =>
          this.#standardTeamCreation!.prepareMemberMessageEffect(
            stableTeamId,
            slotIdValue,
            content,
            files,
          ),
      });
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    if (files.length > 0) {
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "Orchestrated Team member-message attachments are unavailable",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const stableSlotId = teamMemberId(slotIdValue);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    this.#emit({
      type: "team.teammateMessage",
      payload: {
        conversation_id: conversationId(team, member),
        content,
        from_slot_id: member.memberId,
        from_name: member.displayName,
      },
    });
    return null;
  }

  async #sendMessage(
    teamIdValue: string,
    content: string,
    files: readonly string[],
    requestNonce: string,
  ): Promise<NativeAionUiTeamRunAck | NativeAionUiStandardTeamRunAck> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#deliverStandardTeamMessage({
        teamId: stableTeamId,
        targetSlotId: null,
        content,
        files,
        requestNonce,
        prepareEffect: () =>
          this.#standardTeamCreation!.prepareMessageEffect(stableTeamId, content, files),
      });
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    if (this.#admission === null) {
      throw new AionUiTeamBridgePortError(
        "team-planner-unavailable",
        "Team planning is unavailable",
      );
    }
    const orchestrator = await this.#ensureWorkerRuntime(team);
    await this.#assertNoActiveRun(team.teamId);
    const existingRuns = await this.#persistence.listTeamRunsForTeam(team.teamId, 100);
    const goal = orchestratedTaskGoal(content, files);
    const plan = await this.#admission.propose({
      protocolVersion: 1,
      correlationId: correlationId(
        `correlation-team-ui-${digest(`${team.teamId}:${String(existingRuns.length + 1)}:${content}`)}`,
      ),
      planVersion: 1,
      goal,
      workerCapabilities: Object.freeze([
        ...new Set(team.members.map(({ capability }) => capability)),
      ]),
      contextReferences: Object.freeze([
        Object.freeze({
          referenceId: team.workspaceId,
          classification: "internal",
        }),
      ]),
      generalRequirements: generalRequirementsForTask(content, files),
      limits: Object.freeze({
        maxNodes: 5,
        maxDepth: 4,
        maxConcurrency: 2,
        maxTotalAttempts: 10,
      }),
    });
    const accepted = await orchestrator.create({
      team,
      planId: plan.planId,
      occurredAt: instant(this.#now()),
    });
    const started = await orchestrator.start(accepted.runId, instant(this.#now()));
    return Object.freeze({
      enqueue_status: "accepted",
      message_id: teamMessageId(started, goal),
      run: projectRunEvent(team, started, "user_message"),
    });
  }

  async #runState(
    teamIdValue: string,
  ): Promise<NativeAionUiTeamRunState | NativeAionUiStandardTeamRunState> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.getRunState(stableTeamId);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const snapshot = await this.#latestRun(team.teamId);
    return this.#projectRunState(team, snapshot);
  }

  async #renewActiveLease(
    teamIdValue: string,
  ): Promise<null | NativeAionUiTeamRunState | NativeAionUiStandardTeamRunState> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      await this.#standardTeamCreation.renewActiveLease(stableTeamId);
      return null;
    }
    return this.#runState(stableTeamId);
  }

  async #ensureSession(
    teamIdValue: string,
  ): Promise<NativeAionUiTeamRunState | NativeAionUiStandardTeam> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.ensureSession(stableTeamId);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const snapshot = await this.#latestRun(team.teamId);
    return this.#projectRunState(team, snapshot);
  }

  async #stopSession(
    teamIdValue: string,
  ): Promise<NativeAionUiTeamRunState | NativeAionUiStandardTeamRunState> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.stopSession(stableTeamId);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const team = await this.#requireTeam(stableTeamId);
    const snapshot = await this.#latestRun(team.teamId);
    if (snapshot === null || TERMINAL_RUN_STATUSES.has(snapshot.status)) {
      return this.#projectRunState(team, snapshot);
    }
    const orchestrator = await this.#ensureWorkerRuntime(team);
    const cancelled = await orchestrator.cancelRun({
      runId: snapshot.runId,
      reason: "The AionUI Team session was stopped.",
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, cancelled);
  }

  async #cancelRun(
    teamIdValue: string,
    runIdValue: string,
    reason: string,
  ): Promise<NativeAionUiTeamRunState | NativeAionUiStandardTeamRunState> {
    const stableTeamId = teamExperienceId(teamIdValue);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      return this.#standardTeamCreation.cancelRun(stableTeamId, runIdValue, reason);
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const { team, snapshot } = await this.#requireRun(stableTeamId, runIdValue);
    const orchestrator = await this.#ensureWorkerRuntime(team);
    const cancelled = await orchestrator.cancelRun({
      runId: snapshot.runId,
      reason,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, cancelled);
  }

  async #controlNode(
    route: Extract<AionUiTeamBridgeRoute, { kind: TeamControlKind }>,
  ): Promise<NativeAionUiTeamRunState | NativeAionUiStandardTeamRunState> {
    const stableTeamId = teamExperienceId(route.teamId);
    const binding = await this.#persistence.getTeamExperienceBinding(stableTeamId);
    if (binding?.experience === "standard") {
      if (this.#standardTeamCreation === null) {
        throw new AionUiTeamBridgePortError("team-unavailable", "Standard Team is unavailable");
      }
      if (route.kind === "pause-node") {
        return this.#standardTeamCreation.pauseMemberWork(
          stableTeamId,
          route.runId,
          route.slotId,
          route.reason,
        );
      }
      if (route.kind === "cancel-node") {
        return this.#standardTeamCreation.cancelMemberWork(
          stableTeamId,
          route.runId,
          route.slotId,
          route.reason,
        );
      }
      throw new AionUiTeamBridgePortError(
        "team-unavailable",
        "This standard Team control is unavailable",
      );
    }
    if (binding?.experience !== "orchestrated") {
      throw new AionUiTeamBridgePortError(
        "team-conflict",
        "Team experience does not match durable authority",
      );
    }
    const { team, snapshot } = await this.#requireRun(route.teamId, route.runId);
    const node = this.#nodeForSlot(team, snapshot, route.slotId, route.kind);
    const input: TeamNodeControlInput = {
      runId: snapshot.runId,
      nodeId: node.nodeId,
      reason: route.reason,
      occurredAt: instant(this.#now()),
    };
    const orchestrator = await this.#ensureWorkerRuntime(team);
    let next: TeamRunSnapshot;
    switch (route.kind) {
      case "pause-node":
        next = await orchestrator.pause(input);
        break;
      case "resume-node":
        next = await orchestrator.resume(input);
        break;
      case "retry-node":
        next = await orchestrator.retry(input);
        break;
      case "replace-node":
        next = await orchestrator.replace(input);
        break;
      case "handoff-node":
        next = await orchestrator.requestHandoff(input);
        break;
      case "revise-node":
        next = await orchestrator.requestRevision(input);
        break;
      case "cancel-node":
        next = await orchestrator.cancelNode(input);
        break;
    }
    return this.#projectRunState(team, next);
  }

  async #decideApproval(
    teamIdValue: string,
    runIdValue: string,
    slotIdValue: string,
    decision: "approved" | "denied",
  ): Promise<NativeAionUiTeamRunState> {
    const { team, snapshot } = await this.#requireRun(teamIdValue, runIdValue);
    const node = this.#nodeForSlot(team, snapshot, slotIdValue, "decide-approval");
    if (node.protectedApproval === null) {
      throw new AionUiTeamBridgePortError("team-conflict", "Team node has no active Approval");
    }
    const orchestrator = await this.#ensureWorkerRuntime(team);
    const next = await orchestrator.decideApproval({
      runId: snapshot.runId,
      nodeId: node.nodeId,
      approvalId: node.protectedApproval.approvalId,
      decision,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, next);
  }

  async #resolveFeedback(
    teamIdValue: string,
    runIdValue: string,
    decision: "approved" | "denied",
    note: string,
  ): Promise<NativeAionUiTeamRunState> {
    const { team, snapshot } = await this.#requireRun(teamIdValue, runIdValue);
    // Core parks a dependency-satisfied human-feedback node at approval-blocked, never at
    // ready, so this mirrors the precondition resolveWorkflowFeedback itself enforces.
    const node = snapshot.nodes.find(
      (candidate) =>
        candidate.kind === "human-feedback" &&
        candidate.status === "approval-blocked" &&
        candidate.blockedReason === "human-feedback" &&
        candidate.protectedApproval === null &&
        candidate.workflowFeedback === null,
    );
    if (node === undefined) {
      throw new AionUiTeamBridgePortError("team-conflict", "Team feedback is not ready");
    }
    const orchestrator = await this.#ensureWorkerRuntime(team);
    const next = await orchestrator.resolveFeedback({
      runId: snapshot.runId,
      nodeId: node.nodeId,
      decision,
      note,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, next);
  }

  async #completeHandoff(
    route: Extract<AionUiTeamBridgeRoute, { kind: "complete-handoff" }>,
  ): Promise<NativeAionUiTeamRunState> {
    const key = `${route.teamId}\u0000${route.runId}\u0000${route.slotId}`;
    const previous = this.#handoffMutations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch((): undefined => undefined).then(() => slot);
    this.#handoffMutations.set(key, current);
    await previous.catch((): undefined => undefined);
    try {
      return await this.#completeHandoffSerialized(route);
    } finally {
      release();
      if (this.#handoffMutations.get(key) === current) this.#handoffMutations.delete(key);
    }
  }

  async #completeHandoffSerialized(
    route: Extract<AionUiTeamBridgeRoute, { kind: "complete-handoff" }>,
  ): Promise<NativeAionUiTeamRunState> {
    const { team, snapshot } = await this.#requireRun(route.teamId, route.runId);
    const node = this.#nodeForSlot(team, snapshot, route.slotId, "complete-handoff");
    if (node.kind !== "worker" || node.status !== "handoff-required") {
      throw new AionUiTeamBridgePortError("team-conflict", "Team handoff is not ready");
    }
    const stableDigest = digest(`${snapshot.runId}\u0000${node.nodeId}\u0000${route.content}`);
    const stableArtifactId = artifactId(`artifact-team-handoff-${stableDigest}`);
    const stableSessionId = sessionId(`session-team-handoff-${stableDigest}`);
    const stableWorkerId = workerId(`worker-team-handoff-${stableDigest}`);
    const stableRequestId = toolRequestId(`request-team-handoff-${stableDigest}`);
    const stableReference = toolOutputReference(`output-team-handoff-${stableDigest}`);
    const completedAt = instant(this.#now());

    await withPersistenceMutationBarrier(this.#persistence as ActestraPersistencePort, async () => {
      const graph = await this.#persistence.loadDomainGraph();
      const existingTask = graph.tasks.find(({ id }) => id === node.taskId);
      const existingWorker = graph.workers.find(({ id }) => id === stableWorkerId);
      const existingSession = graph.sessions.find(({ id }) => id === stableSessionId);
      const existingArtifact = graph.artifacts.find(({ id }) => id === stableArtifactId);
      const conflicts =
        (existingTask !== undefined && existingTask.workspaceId !== team.workspaceId) ||
        (existingWorker !== undefined && existingWorker.workspaceId !== team.workspaceId) ||
        (existingSession !== undefined &&
          (existingSession.workspaceId !== team.workspaceId ||
            existingSession.taskId !== node.taskId ||
            existingSession.workerId !== stableWorkerId)) ||
        (existingArtifact !== undefined &&
          (existingArtifact.workspaceId !== team.workspaceId ||
            existingArtifact.taskId !== node.taskId ||
            existingArtifact.sessionId !== stableSessionId ||
            existingArtifact.kind !== node.expectedArtifactKind));
      if (conflicts) {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "Team handoff persistence conflicts with durable authority",
        );
      }
      const next = Object.freeze({
        ...graph,
        tasks: Object.freeze(
          existingTask === undefined
            ? [
                ...graph.tasks,
                Object.freeze({
                  id: taskId(node.taskId),
                  workspaceId: team.workspaceId,
                  title: node.title,
                  state: "completed" as const,
                  activeSessionId: stableSessionId,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }),
              ]
            : graph.tasks.map((candidate) =>
                candidate.id === node.taskId
                  ? Object.freeze({
                      ...candidate,
                      state: "completed" as const,
                      activeSessionId: stableSessionId,
                      updatedAt: completedAt,
                    })
                  : candidate,
              ),
        ),
        workers: Object.freeze(
          existingWorker === undefined
            ? [
                ...graph.workers,
                Object.freeze({
                  id: stableWorkerId,
                  workspaceId: team.workspaceId,
                  adapterKind: "actestra-human-handoff",
                  state: "stopped" as const,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }),
              ]
            : graph.workers,
        ),
        sessions: Object.freeze(
          existingSession === undefined
            ? [
                ...graph.sessions,
                Object.freeze({
                  id: stableSessionId,
                  workspaceId: team.workspaceId,
                  taskId: taskId(node.taskId),
                  workerId: stableWorkerId,
                  state: "completed" as const,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }),
              ]
            : graph.sessions,
        ),
        artifacts: Object.freeze(
          existingArtifact === undefined
            ? [
                ...graph.artifacts,
                Object.freeze({
                  id: stableArtifactId,
                  workspaceId: team.workspaceId,
                  taskId: taskId(node.taskId),
                  sessionId: stableSessionId,
                  kind: node.expectedArtifactKind,
                  label: "Reviewed manual handoff result",
                  state: "available" as const,
                  createdAt: completedAt,
                  updatedAt: completedAt,
                }),
              ]
            : graph.artifacts,
        ),
      });
      assertDomainGraph(next);
      await this.#persistence.replaceDomainGraph(next);
      await this.#persistence.storeContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: stableReference,
        kind: "tool-output",
        owner: {
          workspaceId: team.workspaceId,
          taskId: taskId(node.taskId),
          sessionId: stableSessionId,
          workerId: stableWorkerId,
          requestId: stableRequestId,
        },
        classification: "task-content",
        mediaType: "text/plain; charset=utf-8",
        content: route.content,
        createdAt: completedAt,
      });
    });

    const orchestrator = await this.#ensureWorkerRuntime(team);
    const next = await orchestrator.completeHandoff({
      runId: snapshot.runId,
      nodeId: node.nodeId,
      artifacts: [
        {
          artifactId: stableArtifactId,
          taskId: taskId(node.taskId),
          kind: node.expectedArtifactKind,
        },
      ],
      summary: route.content,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, next);
  }

  #nodeForSlot(
    team: TeamDefinition,
    snapshot: TeamRunSnapshot,
    slotIdValue: string,
    action: TeamControlKind | "decide-approval" | "complete-handoff",
  ): TeamRunNode {
    const stableSlotId = teamMemberId(slotIdValue);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    // revise-node targets the leader's workflow-feedback node, the only node kind Core admits
    // for request-feedback-revision. Every other control acts on a Worker node.
    if (action === "revise-node") {
      const feedbackNode = snapshot.nodes.find(
        (candidate) =>
          candidate.kind === "human-feedback" &&
          candidate.status === "revision-requested" &&
          candidate.blockedReason === "revision-requested",
      );
      if (feedbackNode === undefined || member.role !== "leader") {
        throw new AionUiTeamBridgePortError(
          "team-conflict",
          "Team member has no revisable feedback node",
        );
      }
      return feedbackNode;
    }
    const allowed =
      action === "decide-approval"
        ? ["approval-blocked"]
        : action === "complete-handoff"
          ? ["handoff-required"]
          : action === "resume-node"
            ? ["paused"]
            : action === "retry-node"
              ? ["failed"]
              : action === "pause-node"
                ? ["running"]
                : ["running", "approval-blocked", "paused", "failed", "handoff-required"];
    const node = snapshot.nodes.find(
      (candidate) =>
        candidate.kind === "worker" &&
        candidate.capability === member.capability &&
        allowed.includes(candidate.status),
    );
    if (node === undefined) {
      throw new AionUiTeamBridgePortError("team-conflict", "Team member has no controllable node");
    }
    return node;
  }

  async #requireRun(
    teamIdValue: string,
    runIdValue: string,
  ): Promise<{
    readonly team: TeamDefinition;
    readonly snapshot: TeamRunSnapshot;
  }> {
    const team = await this.#requireTeam(teamIdValue);
    const stableRunId = teamRunId(runIdValue);
    const snapshot = (await this.#persistence.listTeamRunsForTeam(team.teamId, 100)).find(
      ({ runId }) => runId === stableRunId,
    );
    if (snapshot === undefined || snapshot.teamId !== team.teamId) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team run does not exist");
    }
    return { team, snapshot };
  }

  async #requireTeam(teamIdValue: string): Promise<TeamDefinition> {
    const stableExperienceId = teamExperienceId(teamIdValue);
    await this.#requireExperience(stableExperienceId, "orchestrated");
    const stableTeamId = teamId(stableExperienceId);
    const team = await this.#persistence.getTeamDefinition(stableTeamId);
    if (team === null) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team does not exist");
    }
    return normalizeTeamDefinition(JSON.parse(JSON.stringify(team)));
  }

  async #latestRun(teamIdValue: TeamDefinition["teamId"]): Promise<TeamRunSnapshot | null> {
    return (await this.#persistence.listTeamRunsForTeam(teamIdValue, 1))[0] ?? null;
  }

  async #nativeTeam(teamValue: TeamDefinition): Promise<NativeAionUiTeam> {
    const team = normalizeTeamDefinition(JSON.parse(JSON.stringify(teamValue)));
    return projectNativeTeam(team, await this.#latestRun(team.teamId));
  }

  async #projectRunState(
    team: TeamDefinition,
    snapshot: TeamRunSnapshot | null,
  ): Promise<NativeAionUiTeamRunState> {
    return Object.freeze({
      session_generation:
        snapshot === null ? null : `schema-15-revision-${String(snapshot.revision)}`,
      submission: Object.freeze(
        this.#admission === null
          ? {
              availability: "unavailable" as const,
              blocked_reason: "planner-unavailable" as const,
              next_action: "restart-after-planner-admission" as const,
              authority_source: "actestra-main-runtime" as const,
            }
          : this.#initialOrchestrator === null &&
              (this.#workerRuntimeAdmission === null || team.modelSelection === undefined)
            ? {
                availability: "unavailable" as const,
                blocked_reason: "worker-runtime-unavailable" as const,
                next_action: "configure-worker-runtime" as const,
                authority_source: "actestra-main-runtime" as const,
              }
            : {
                availability: "available" as const,
                blocked_reason: null,
                next_action: "submit-task" as const,
                authority_source: "actestra-main-runtime" as const,
              },
      ),
      active_run:
        snapshot === null
          ? null
          : projectRunEvent(
              team,
              snapshot,
              "system_lifecycle",
              await this.#resolveArtifactDeliveries(snapshot),
            ),
      slot_work: Object.freeze(team.members.map((member) => projectSlot(team, snapshot, member))),
      activities:
        snapshot === null ? Object.freeze([]) : await this.#projectActivities(team, snapshot),
    });
  }

  /**
   * Resolves the delivery projection for each coding Artifact a Team produced, so the Team surface
   * renders the same Artifact card as the non-Team surface instead of an inert tag.
   *
   * Keyed by Artifact, and only for coding nodes: a General node writes no patch. The apply itself
   * is still driven through the coding journey bridge, so the deterministic conversation the node
   * ran under travels with the projection.
   */
  async #resolveArtifactDeliveries(
    snapshot: TeamRunSnapshot,
  ): Promise<ReadonlyMap<string, NativeAionUiTeamArtifactDelivery>> {
    const deliveries = new Map<string, NativeAionUiTeamArtifactDelivery>();
    for (const node of snapshot.nodes) {
      const attempt = node.attempts.at(-1);
      if (node.kind !== "worker" || node.capability !== "coding" || attempt === undefined) continue;
      if (node.artifacts.length === 0) continue;
      let nativeConversationId: string;
      try {
        nativeConversationId = deriveTeamJourneyBinding({
          runId: snapshot.runId,
          nodeId: node.nodeId,
          attemptNumber: attempt.attemptNumber,
          capability: node.capability,
        }).nativeConversationId;
      } catch {
        // A node whose identity cannot be derived simply renders without apply controls.
        continue;
      }
      for (const artifact of node.artifacts) {
        try {
          const records = await this.#persistence.listArtifactDeliveriesForTask(
            artifact.taskId,
            TEAM_ARTIFACT_DELIVERY_SCAN_LIMIT,
          );
          const record = records.find((entry) => entry.artifactId === artifact.artifactId);
          if (record === undefined) continue;
          const projection = projectArtifactDelivery(record);
          deliveries.set(
            artifact.artifactId,
            Object.freeze({
              native_conversation_id: nativeConversationId,
              delivery_state: projection.deliveryState,
              base_commit: projection.baseCommit,
              changed_file_count: projection.changedFileCount,
              ...(projection.failureCode === undefined
                ? {}
                : { failure_code: projection.failureCode }),
              ...(projection.applyApprovalId === undefined
                ? {}
                : { apply_approval_id: projection.applyApprovalId }),
            }),
          );
        } catch {
          // Delivery is supplementary: a read failure must not break the run projection.
        }
      }
    }
    return deliveries;
  }

  /**
   * Reads each Worker node's own durable journey stream for the last assistant
   * reply. The operational Worker summary is Worker-authored and stays out of
   * the projection, so this is the only sanctioned source for the real answer.
   */
  async #resolveWorkerReplies(
    snapshot: TeamRunSnapshot,
  ): Promise<
    ReadonlyMap<string, Readonly<{ eventId: string; content: string; occurredAt: Instant }>>
  > {
    const replies = new Map<
      string,
      Readonly<{ eventId: string; content: string; occurredAt: Instant }>
    >();
    for (const node of snapshot.nodes) {
      const attempt = node.attempts.at(-1);
      if (node.kind !== "worker" || node.capability === null || attempt === undefined) continue;
      try {
        const events = await this.#persistence.replayEvents(
          deriveTeamJourneyReplyStreamId({
            runId: snapshot.runId,
            nodeId: node.nodeId,
            attemptNumber: attempt.attemptNumber,
            capability: node.capability,
          }),
        );
        for (const event of events) {
          if (event.type !== "agent.message" || event.payload.role !== "assistant") continue;
          const content = boundedActivityContent(event.payload.content);
          if (content.length === 0) continue;
          replies.set(node.nodeId, {
            eventId: event.eventId,
            content,
            occurredAt: event.occurredAt,
          });
        }
      } catch (error) {
        // One corrupt journey stream cannot break Team projection, but a
        // programming defect must stay visible instead of reading as "no reply".
        if (error instanceof TypeError || error instanceof ReferenceError) throw error;
      }
    }
    return replies;
  }

  async #projectActivities(
    team: TeamDefinition,
    snapshot: TeamRunSnapshot,
  ): Promise<readonly NativeAionUiTeamActivity[]> {
    const replies = await this.#resolveWorkerReplies(snapshot);
    const planValue = await this.#persistence.getAdmittedTeamPlan(snapshot.planId);
    if (planValue === null) {
      throw new AionUiTeamBridgePortError(
        "team-execution-failed",
        "Team run has no authoritative admitted plan",
      );
    }
    const plan = normalizeAdmittedTeamPlan(JSON.parse(JSON.stringify(planValue)));
    const userActivity: NativeAionUiTeamActivity = Object.freeze({
      id: teamMessageId(snapshot, plan.goal),
      author: "You",
      slot_id: null,
      content: plan.goal,
      tone: "user",
      occurred_at: toMillis(snapshot.createdAt),
    });
    const workerActivities = snapshot.nodes
      .flatMap((node): readonly NativeAionUiTeamActivity[] => {
        if (node.kind !== "worker" || node.summary === null) return [];
        const occurredAt = node.attempts.at(-1)?.updatedAt ?? snapshot.updatedAt;
        const artifactCount = node.artifacts.length;
        const slotId =
          team.members.find(({ capability }) => capability === node.capability)?.memberId ?? null;
        const reply = replies.get(node.nodeId);
        return [
          Object.freeze({
            id: `team-activity-${digest(`${snapshot.runId}:${node.nodeId}:${occurredAt}:${String(artifactCount)}`)}`,
            author: node.capability === "general" ? "General Worker" : "Goose",
            slot_id: slotId,
            content: `${node.title} completed with ${String(artifactCount)} durable Artifact ${artifactCount === 1 ? "reference" : "references"}.`,
            tone: "worker",
            occurred_at: toMillis(occurredAt),
          }),
          ...(reply === undefined
            ? []
            : [
                Object.freeze({
                  id: `team-activity-${digest(`${snapshot.runId}:${node.nodeId}:reply:${reply.eventId}`)}`,
                  author: node.capability === "general" ? "General Worker" : "Goose",
                  slot_id: slotId,
                  content: reply.content,
                  tone: "worker" as const,
                  occurred_at: toMillis(reply.occurredAt),
                }),
              ]),
        ];
      })
      .sort(
        (left, right) =>
          left.occurred_at - right.occurred_at || left.id.localeCompare(right.id, "en"),
      );
    return Object.freeze([userActivity, ...workerActivities]);
  }

  async #assertNoActiveRun(teamIdValue: TeamDefinition["teamId"]): Promise<void> {
    const snapshot = await this.#latestRun(teamIdValue);
    if (snapshot !== null && !TERMINAL_RUN_STATUSES.has(snapshot.status)) {
      throw new AionUiTeamBridgePortError("team-active", "Team has an active run");
    }
  }

  #nextUpdate(team: TeamDefinition): Instant {
    return nextInstant(instant(this.#now()), team.updatedAt);
  }

  #emit(event: AionUiTeamEvent): void {
    for (const handler of this.#handlers) {
      try {
        handler(event);
      } catch {
        // UI observers cannot change Team authority.
      }
    }
  }

  async #emitSnapshot(snapshotValue: TeamRunSnapshot): Promise<void> {
    try {
      const snapshot = snapshotValue;
      const team = await this.#persistence.getTeamDefinition(snapshot.teamId);
      if (team === null || this.#closed) return;
      this.#emit({
        type: eventType(snapshot),
        payload: projectRunEvent(
          team,
          snapshot,
          "system_lifecycle",
          await this.#resolveArtifactDeliveries(snapshot),
        ),
      } as AionUiTeamEvent);
    } catch {
      // Projection failure cannot change or interrupt persisted orchestration.
    }
  }
}
