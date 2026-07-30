import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { parse } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  AIONUI_GENERAL_WORK_CONTRACT_VERSION,
  AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
  assertAionUiGeneralWorkArtifactPreview,
  assertAionUiGeneralWorkIntent,
  assertAionUiGeneralWorkProjection,
  hashAionUiGeneralWorkConversation,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkArtifactPreview,
  type AionUiGeneralWorkJourneyKind,
  type AionUiGeneralWorkProjection,
  type AionUiGeneralWorkRegistration,
} from "../../compatibility/aionui";
import {
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  artifactId,
  compareInstants,
  correlationId,
  eventStreamId,
  sessionId,
  serializeScopedNativeToolInput,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ActestraPersistencePort,
  type AgentClock,
  type Artifact,
  type DomainGraph,
  type GeneralWorkCheckpoint,
  type Instant,
  type Session,
  type Task,
  type ToolRequestId,
} from "../../core";
import type { ScopedNativeToolPlatform } from "../privileged/scopedNativeToolPlatform";
import { AgentAdapterSupervisor } from "../workers/agentAdapterSupervisor";
import { GeneralWorkCoordinator } from "../workers/generalWorkCoordinator";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  type GeneralWorkerProcessAdapter,
} from "../workers/generalWorkerProcessAdapter";
import type {
  AionUiGeneralWorkNativeContext,
  AionUiGeneralWorkNativeContextPort,
} from "./aionuiGeneralWorkNativeContext";
import { MAX_GENERAL_WORKER_SEND_CONTENT_BYTES } from "../../shared/generalWorkerProtocol";

const MAX_TITLE_BYTES = 512;
const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_WORKSPACE_DISPLAY_NAME_BYTES = 128;
const CANCELLABLE_TASK_STATES = new Set(["running", "blocked"]);

interface JourneyIdentities {
  readonly workspaceId: ReturnType<typeof workspaceId>;
  readonly taskId: ReturnType<typeof taskId>;
  readonly sessionId: ReturnType<typeof sessionId>;
  readonly workerId: ReturnType<typeof workerId>;
  readonly streamId: ReturnType<typeof eventStreamId>;
  readonly correlationId: ReturnType<typeof correlationId>;
  readonly messageId: ReturnType<typeof correlationId>;
  readonly promptRef: ReturnType<typeof toolInputReference>;
  readonly readInputRef: ReturnType<typeof toolInputReference>;
  readonly toolInputRef: ReturnType<typeof toolInputReference>;
  readonly readRequestId: ReturnType<typeof toolRequestId>;
  readonly requestId: ReturnType<typeof toolRequestId>;
  readonly artifactId: ReturnType<typeof artifactId>;
  readonly grantId: ReturnType<typeof workspaceGrantId>;
}

interface ActiveJourney {
  readonly adapter: GeneralWorkerProcessAdapter;
  readonly supervisor: AgentAdapterSupervisor;
  readonly coordinator: GeneralWorkCoordinator;
  readonly sessionId: ReturnType<typeof sessionId>;
  readonly completion: Promise<void>;
}

export interface AionUiGeneralWorkJourneyServiceConfig {
  readonly persistence: ActestraPersistencePort;
  readonly nativeTools: ScopedNativeToolPlatform;
  readonly clock: AgentClock;
  readonly nativeContext: AionUiGeneralWorkNativeContextPort;
  readonly launchWorker: (input: {
    readonly journeyKind: AionUiGeneralWorkJourneyKind;
    readonly readRequestId: ToolRequestId;
    readonly requestId: ToolRequestId;
  }) => Promise<GeneralWorkerProcessAdapter>;
}

export interface AionUiPreparedGeneralWorkRecoverySummary {
  readonly attempted: number;
  readonly started: number;
  readonly failed: number;
}

export class AionUiGeneralWorkJourneyServiceError extends Error {
  constructor(
    readonly code: "task-not-owned" | "task-conflict" | "execution-failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiGeneralWorkJourneyServiceError";
  }
}

function journeyDigest(conversationHash: string, submissionId: string): string {
  return createHash("sha256")
    .update(
      `actestra-aionui-general-work\u0000${String(
        AIONUI_GENERAL_WORK_CONTRACT_VERSION,
      )}\u0000${conversationHash}\u0000${submissionId}`,
    )
    .digest("hex");
}

function identitiesFor(conversationHash: string, submissionId: string): JourneyIdentities {
  const digest = journeyDigest(conversationHash, submissionId);
  return identitiesForDigest(digest);
}

function identitiesForDigest(digest: string): JourneyIdentities {
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("AionUI general-work task identity has no recoverable digest");
  }
  return Object.freeze({
    workspaceId: workspaceId(`workspace-aionui-${digest}`),
    taskId: taskId(`task-aionui-${digest}`),
    sessionId: sessionId(`session-aionui-${digest}`),
    workerId: workerId(`worker-aionui-${digest}`),
    streamId: eventStreamId(`stream-aionui-${digest}`),
    correlationId: correlationId(`correlation-aionui-${digest}`),
    messageId: correlationId(`message-aionui-${digest}`),
    promptRef: toolInputReference(`input-aionui-prompt-${digest}`),
    readInputRef: toolInputReference(`input-aionui-file-read-${digest}`),
    toolInputRef: toolInputReference(`input-aionui-output-${digest}`),
    readRequestId: toolRequestId(`request-aionui-file-read-${digest}`),
    requestId: toolRequestId(`request-aionui-output-${digest}`),
    artifactId: artifactId(`artifact-aionui-${digest}`),
    grantId: workspaceGrantId(`grant-aionui-${digest}`),
  });
}

function identitiesForTask(task: Task): JourneyIdentities {
  const prefix = "task-aionui-";
  if (!task.id.startsWith(prefix)) {
    throw new Error("Prepared AionUI task identity is not recoverable");
  }
  return identitiesForDigest(task.id.slice(prefix.length));
}

function assertPreparedJourneyGraph(
  task: Task,
  graph: DomainGraph,
  identities: JourneyIdentities,
): void {
  const session = graph.sessions.find((candidate) => candidate.id === identities.sessionId);
  const worker = graph.workers.find((candidate) => candidate.id === identities.workerId);
  if (
    session === undefined ||
    worker === undefined ||
    task.workspaceId !== identities.workspaceId ||
    session.workspaceId !== identities.workspaceId ||
    session.taskId !== task.id ||
    session.workerId !== worker.id ||
    worker.workspaceId !== identities.workspaceId ||
    worker.adapterKind !== GENERAL_WORKER_ADAPTER_KIND
  ) {
    throw new Error("AionUI general-work identities conflict with authoritative state");
  }
}

function boundedPresentationText(value: string, maximumBytes: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  let result = "";
  let byteLength = 0;
  for (const character of normalized) {
    const nextLength = new TextEncoder().encode(character).byteLength;
    if (byteLength + nextLength > maximumBytes) {
      break;
    }
    result += character;
    byteLength += nextLength;
  }
  return result;
}

function assertCancellationReason(value: unknown): asserts value is string | undefined {
  if (value === undefined) {
    return;
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
    })
  ) {
    throw new Error("AionUI general-work cancellation reason must be bounded presentation text");
  }
}

function registrationFor(
  intent: AionUiGeneralWorkIntent,
  conversationHash: string,
  identities: JourneyIdentities,
  createdAt: Instant,
  nativeContext: AionUiGeneralWorkNativeContext,
): AionUiGeneralWorkRegistration {
  const title = boundedPresentationText(intent.prompt, MAX_TITLE_BYTES);
  const journeyKind = intent.journeyKind ?? "prompt-artifact";
  const outputContent = `# Actestra result\n\n${intent.prompt.trim()}\n`;
  const initialToolInput =
    journeyKind !== "prompt-artifact"
      ? {
          reference: identities.readInputRef,
          requestId: identities.readRequestId,
          content: serializeScopedNativeToolInput(WORKSPACE_READ_TEXT_TOOL_ID, {
            contractVersion: 1,
            relativePath:
              journeyKind === "local-research-artifact"
                ? "actestra-research.txt"
                : "actestra-input.txt",
            maximumBytes: MAX_GENERAL_WORKER_SEND_CONTENT_BYTES,
          }),
        }
      : {
          reference: identities.toolInputRef,
          requestId: identities.requestId,
          content: serializeScopedNativeToolInput(TASK_OUTPUT_WRITE_TEXT_TOOL_ID, {
            contractVersion: 1,
            relativePath: "result.md",
            mediaType: "text/markdown; charset=utf-8",
            content: outputContent,
          }),
        };
  const common = {
    workspace: Object.freeze({
      id: identities.workspaceId,
      name: nativeContext.displayName,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    }),
    task: Object.freeze({
      id: identities.taskId,
      workspaceId: identities.workspaceId,
      title,
      state: "ready",
      activeSessionId: identities.sessionId,
      createdAt,
      updatedAt: createdAt,
    }),
    session: Object.freeze({
      id: identities.sessionId,
      workspaceId: identities.workspaceId,
      taskId: identities.taskId,
      workerId: identities.workerId,
      state: "created",
      createdAt,
      updatedAt: createdAt,
    }),
    worker: Object.freeze({
      id: identities.workerId,
      workspaceId: identities.workspaceId,
      adapterKind: GENERAL_WORKER_ADAPTER_KIND,
      state: "created",
      createdAt,
      updatedAt: createdAt,
    }),
    workspaceGrant: Object.freeze({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: identities.grantId,
      workspaceId: identities.workspaceId,
      rootPath: nativeContext.rootPath,
      displayName: nativeContext.displayName,
      state: "active",
      createdAt,
      updatedAt: createdAt,
    }),
    promptReference: Object.freeze({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: identities.promptRef,
      kind: "tool-input",
      owner: Object.freeze({
        workspaceId: identities.workspaceId,
        taskId: identities.taskId,
        sessionId: identities.sessionId,
        workerId: identities.workerId,
        grantId: identities.grantId,
      }),
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: intent.prompt,
      createdAt,
    }),
  } as const;
  const initialInputReference = Object.freeze({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: initialToolInput.reference,
    kind: "tool-input",
    owner: Object.freeze({
      workspaceId: identities.workspaceId,
      taskId: identities.taskId,
      sessionId: identities.sessionId,
      workerId: identities.workerId,
      requestId: initialToolInput.requestId,
      grantId: identities.grantId,
    }),
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: initialToolInput.content,
    createdAt,
  });
  if (journeyKind === "workspace-file-artifact") {
    return Object.freeze({
      ...common,
      link: Object.freeze({
        contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
        conversationHash,
        taskId: identities.taskId,
        journeyKind: "workspace-file-artifact",
        createdAt,
      }),
      readInputReference: initialInputReference,
    });
  }
  if (journeyKind === "local-research-artifact") {
    return Object.freeze({
      ...common,
      link: Object.freeze({
        contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
        conversationHash,
        taskId: identities.taskId,
        journeyKind: "local-research-artifact",
        createdAt,
      }),
      readInputReference: initialInputReference,
    });
  }
  return Object.freeze({
    ...common,
    link: Object.freeze({
      contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
      conversationHash,
      taskId: identities.taskId,
      journeyKind: "prompt-artifact",
      createdAt,
    }),
    toolInputReference: initialInputReference,
  });
}

function latestSession(task: Task, graph: DomainGraph): Session | undefined {
  return graph.sessions
    .filter((session) => session.taskId === task.id)
    .sort((left, right) => compareInstants(right.updatedAt, left.updatedAt))[0];
}

function latestAssistantSummary(checkpoint: GeneralWorkCheckpoint | null): string | undefined {
  const event = checkpoint?.events
    .filter(
      (candidate) => candidate.type === "agent.message" && candidate.payload.role === "assistant",
    )
    .at(-1);
  if (event?.type !== "agent.message") {
    return undefined;
  }
  return boundedPresentationText(event.payload.content, MAX_SUMMARY_BYTES);
}

function latestFailureCode(checkpoint: GeneralWorkCheckpoint | null): string | undefined {
  const event = checkpoint?.events
    .filter(
      (candidate) =>
        candidate.type === "task.failed" ||
        candidate.type === "tool.failed" ||
        candidate.type === "worker.failed",
    )
    .at(-1);
  if (
    event?.type !== "task.failed" &&
    event?.type !== "tool.failed" &&
    event?.type !== "worker.failed"
  ) {
    return undefined;
  }
  return event.payload.errorCode;
}

function maximumInstant(values: readonly Instant[]): Instant {
  return values.reduce((latest, value) => (compareInstants(value, latest) > 0 ? value : latest));
}

function projectionArtifacts(task: Task, graph: DomainGraph): readonly Artifact[] {
  return graph.artifacts
    .filter((artifact) => artifact.taskId === task.id)
    .sort((left, right) => compareInstants(left.createdAt, right.createdAt));
}

async function canonicalNativeContext(
  context: AionUiGeneralWorkNativeContext,
): Promise<AionUiGeneralWorkNativeContext> {
  if (
    typeof context.rootPath !== "string" ||
    context.rootPath.trim() !== context.rootPath ||
    context.rootPath.length === 0
  ) {
    throw new Error("AionUI conversation has no bounded workspace root");
  }
  const displayName = boundedPresentationText(
    context.displayName,
    MAX_WORKSPACE_DISPLAY_NAME_BYTES,
  );
  if (displayName.length === 0) {
    throw new Error("AionUI conversation has no bounded workspace name");
  }
  const rootPath = await realpath(context.rootPath);
  if (rootPath === parse(rootPath).root) {
    throw new Error("AionUI conversation workspace root must not be the filesystem root");
  }
  return Object.freeze({
    rootPath,
    displayName,
  });
}

export class AionUiGeneralWorkJourneyService {
  private readonly submissions = new Map<string, Promise<AionUiGeneralWorkProjection>>();
  private readonly activeJourneys = new Map<string, ActiveJourney>();

  constructor(private readonly config: AionUiGeneralWorkJourneyServiceConfig) {}

  submit(value: unknown): Promise<AionUiGeneralWorkProjection> {
    assertAionUiGeneralWorkIntent(value);
    const intent = Object.freeze({ ...value });
    const conversationHash = hashAionUiGeneralWorkConversation(intent.nativeConversationId);
    const identities = identitiesFor(conversationHash, intent.submissionId);
    const existing = this.submissions.get(identities.taskId);
    if (existing !== undefined) {
      return existing;
    }
    const operation = this.submitOnce(intent, conversationHash, identities).finally(() => {
      if (this.submissions.get(identities.taskId) === operation) {
        this.submissions.delete(identities.taskId);
      }
    });
    this.submissions.set(identities.taskId, operation);
    return operation;
  }

  async list(
    nativeConversationId: string,
    limit = AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
  ): Promise<readonly AionUiGeneralWorkProjection[]> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
    ) {
      throw new Error("AionUI general-work projection limit must be from 1 to 100");
    }
    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    const links = await this.config.persistence.listAionUiGeneralWorkJourneyLinks(
      conversationHash,
      limit,
    );
    const graph = await this.config.persistence.loadDomainGraph();
    return Object.freeze(
      await Promise.all(
        links.map(async (link) => {
          const task = graph.tasks.find((candidate) => candidate.id === link.taskId);
          if (task === undefined) {
            throw new Error("AionUI general-work link has no authoritative task");
          }
          return this.project(task, graph);
        }),
      ),
    );
  }

  async cancel(
    nativeConversationId: string,
    taskIdValue: string,
    reason?: string,
  ): Promise<AionUiGeneralWorkProjection> {
    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    const stableTaskId = taskId(taskIdValue);
    assertCancellationReason(reason);
    const links = await this.config.persistence.listAionUiGeneralWorkJourneyLinks(
      conversationHash,
      AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
    );
    if (!links.some((link) => link.taskId === stableTaskId)) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-not-owned",
        "AionUI conversation does not own the requested general-work task",
      );
    }
    let graph = await this.config.persistence.loadDomainGraph();
    let task = graph.tasks.find((candidate) => candidate.id === stableTaskId);
    if (task === undefined) {
      throw new Error("AionUI general-work task is missing from authoritative state");
    }
    const current = await this.project(task, graph);
    if (!current.canCancel) {
      return current;
    }
    const active = this.activeJourneys.get(stableTaskId);
    if (active === undefined) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI general-work task has no active supervised Worker",
      );
    }
    await active.supervisor.cancel(active.sessionId, reason);
    await Promise.allSettled([active.completion]);
    graph = await this.config.persistence.loadDomainGraph();
    task = graph.tasks.find((candidate) => candidate.id === stableTaskId);
    if (task === undefined) {
      throw new Error("AionUI general-work task disappeared after cancellation");
    }
    return this.project(task, graph);
  }

  async preview(
    nativeConversationId: string,
    taskIdValue: string,
    artifactIdValue: string,
  ): Promise<AionUiGeneralWorkArtifactPreview> {
    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    const stableTaskId = taskId(taskIdValue);
    const stableArtifactId = artifactId(artifactIdValue);
    const links = await this.config.persistence.listAionUiGeneralWorkJourneyLinks(
      conversationHash,
      AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
    );
    if (!links.some((link) => link.taskId === stableTaskId)) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-not-owned",
        "AionUI conversation does not own the requested artifact task",
      );
    }
    const graph = await this.config.persistence.loadDomainGraph();
    const task = graph.tasks.find((candidate) => candidate.id === stableTaskId);
    const artifact = graph.artifacts.find(
      (candidate) =>
        candidate.id === stableArtifactId &&
        candidate.taskId === stableTaskId &&
        candidate.state === "available",
    );
    const session =
      artifact?.sessionId === undefined
        ? undefined
        : graph.sessions.find((candidate) => candidate.id === artifact.sessionId);
    const checkpoint =
      session === undefined
        ? null
        : await this.config.persistence.getGeneralWorkCheckpoint(session.id);
    const binding = checkpoint?.artifactBinding;
    if (
      task === undefined ||
      artifact === undefined ||
      checkpoint?.phase !== "finalized" ||
      binding === undefined ||
      session?.taskId !== task.id ||
      checkpoint.attempt.sessionId !== session.id ||
      !isDeepStrictEqual(binding.artifact, artifact)
    ) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI artifact has no matching Actestra ownership evidence",
      );
    }
    const resolved = await this.config.persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: binding.outputRef,
      kind: "tool-output",
      owner: binding.owner,
      resolvedAt: this.config.clock.now(),
      consume: false,
    });
    if (
      resolved.metadata.classification !== "task-content" ||
      (resolved.metadata.mediaType !== "text/plain; charset=utf-8" &&
        resolved.metadata.mediaType !== "text/markdown; charset=utf-8")
    ) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI artifact content has an unsupported authority class",
      );
    }
    const preview = Object.freeze({
      contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
      taskId: task.id,
      artifactId: artifact.id,
      label: artifact.label,
      mediaType: resolved.metadata.mediaType,
      content: resolved.content,
    }) satisfies AionUiGeneralWorkArtifactPreview;
    assertAionUiGeneralWorkArtifactPreview(preview);
    return preview;
  }

  async recoverPrepared(): Promise<AionUiPreparedGeneralWorkRecoverySummary> {
    const links = await this.config.persistence.listPreparedAionUiGeneralWorkJourneyLinks(
      AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
    );
    let started = 0;
    let failed = 0;
    for (const link of links) {
      try {
        const graph = await this.config.persistence.loadDomainGraph();
        const task = graph.tasks.find((candidate) => candidate.id === link.taskId);
        if (task === undefined || task.state !== "ready") {
          throw new Error("Prepared AionUI journey has no ready authoritative task");
        }
        const identities = identitiesForTask(task);
        assertPreparedJourneyGraph(task, graph, identities);
        const prompt = await this.resolvePrompt(identities);
        await this.startPreparedJourney(task, graph, identities, prompt, link.journeyKind);
        started += 1;
      } catch {
        failed += 1;
      }
    }
    return Object.freeze({
      attempted: links.length,
      started,
      failed,
    });
  }

  async waitForIdle(): Promise<void> {
    while (this.activeJourneys.size > 0) {
      await Promise.allSettled(
        [...this.activeJourneys.values()].map(({ completion }) => completion),
      );
    }
  }

  async close(reason = "Actestra desktop is shutting down."): Promise<void> {
    const active = [...this.activeJourneys.values()];
    await Promise.allSettled(
      active.map(({ sessionId: activeSessionId, supervisor }) =>
        supervisor.cancel(activeSessionId, reason),
      ),
    );
    await Promise.allSettled(active.map(({ completion }) => completion));
  }

  private async submitOnce(
    intent: AionUiGeneralWorkIntent,
    conversationHash: string,
    identities: JourneyIdentities,
  ): Promise<AionUiGeneralWorkProjection> {
    const links = await this.config.persistence.listAionUiGeneralWorkJourneyLinks(
      conversationHash,
      AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
    );
    let graph = await this.config.persistence.loadDomainGraph();
    let task = graph.tasks.find((candidate) => candidate.id === identities.taskId);
    const link = links.find((candidate) => candidate.taskId === identities.taskId);
    const journeyKind = intent.journeyKind ?? "prompt-artifact";

    if (link === undefined) {
      if (links.length >= AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION) {
        throw new Error("AionUI general-work conversation reached its bounded journey limit");
      }
      const nativeContext = await canonicalNativeContext(
        await this.config.nativeContext.resolve(intent.nativeConversationId),
      );
      const registration = registrationFor(
        intent,
        conversationHash,
        identities,
        this.config.clock.now(),
        nativeContext,
      );
      await this.config.persistence.registerAionUiGeneralWorkJourney(registration);
      graph = await this.config.persistence.loadDomainGraph();
      task = graph.tasks.find((candidate) => candidate.id === identities.taskId);
    }
    if (task === undefined) {
      throw new Error("AionUI general-work task registration is incomplete");
    }
    if (link !== undefined && link.journeyKind !== journeyKind) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI submission identity conflicts with its durable journey kind",
      );
    }

    assertPreparedJourneyGraph(task, graph, identities);

    if (task.state !== "ready") {
      return this.project(task, graph);
    }
    const existingCheckpoint = await this.config.persistence.getGeneralWorkCheckpoint(
      identities.sessionId,
    );
    if (existingCheckpoint !== null) {
      throw new Error("A ready AionUI general-work task already has a durable attempt");
    }
    const prompt = await this.resolvePrompt(identities);
    if (prompt !== intent.prompt) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI submission identity conflicts with its durable prompt",
      );
    }
    return this.startPreparedJourney(task, graph, identities, prompt, journeyKind);
  }

  private async resolvePrompt(identities: JourneyIdentities): Promise<string> {
    const resolved = await this.config.persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: identities.promptRef,
      kind: "tool-input",
      owner: {
        workspaceId: identities.workspaceId,
        taskId: identities.taskId,
        sessionId: identities.sessionId,
        workerId: identities.workerId,
        grantId: identities.grantId,
      },
      resolvedAt: this.config.clock.now(),
      consume: false,
    });
    if (
      resolved.metadata.classification !== "task-content" ||
      resolved.metadata.mediaType !== "text/plain; charset=utf-8"
    ) {
      throw new Error("Prepared AionUI prompt has an unsupported authority class");
    }
    return resolved.content;
  }

  private async startPreparedJourney(
    task: Task,
    graph: DomainGraph,
    identities: JourneyIdentities,
    prompt: string,
    journeyKind: AionUiGeneralWorkJourneyKind,
  ): Promise<AionUiGeneralWorkProjection> {
    if (this.activeJourneys.has(task.id)) {
      throw new AionUiGeneralWorkJourneyServiceError(
        "task-conflict",
        "AionUI general-work task already has an active supervised Worker",
      );
    }
    const adapter = await this.config.launchWorker({
      journeyKind,
      readRequestId: identities.readRequestId,
      requestId: identities.requestId,
    });
    const supervisor = new AgentAdapterSupervisor(adapter, this.config.clock, {
      expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
      requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      startupTimeoutMs: 10_000,
      heartbeatTimeoutMs: 3_000,
      cancellationTimeoutMs: 2_000,
      maxRestarts: 1,
    });
    const coordinator = new GeneralWorkCoordinator({
      persistence: this.config.persistence,
      clock: this.config.clock,
      supervisor,
      nativeTools: this.config.nativeTools,
    });
    try {
      await supervisor.start({
        workspaceId: identities.workspaceId,
        taskId: identities.taskId,
        sessionId: identities.sessionId,
        workerId: identities.workerId,
        streamId: identities.streamId,
        correlationId: identities.correlationId,
        taskState: "ready",
        startedAt: this.config.clock.now(),
        initialPrompt: prompt,
      });
      const checkpoint = await coordinator.checkpointAttempt(identities.sessionId);
      const projection = this.buildProjection(task, graph, checkpoint);
      let active!: ActiveJourney;
      const completion = Promise.resolve()
        .then(async () => {
          try {
            const activeRequest = supervisor.activeToolRequest(identities.sessionId);
            if (activeRequest !== undefined) {
              const expectedRequest =
                journeyKind !== "prompt-artifact" ? identities.readRequestId : identities.requestId;
              if (activeRequest !== expectedRequest) {
                throw new Error("General Worker requested an unexpected tool identity");
              }
              const grant = await this.config.persistence.getActiveWorkspaceGrant(
                identities.workspaceId,
              );
              if (grant === null || grant.grantId !== identities.grantId) {
                const now = this.config.clock.now();
                await supervisor.resolveTool(activeRequest, {
                  requestId: activeRequest,
                  status: "failed",
                  startedAt: now,
                  completedAt: now,
                  errorCode: "workspace-grant-unavailable",
                  message: "The selected AionUI workspace is not authorized.",
                  mayHaveExecuted: false,
                });
                await supervisor.awaitTerminal(identities.sessionId);
                await coordinator.finalizeAttempt(identities.sessionId);
                return;
              }
              if (journeyKind !== "prompt-artifact") {
                const read = await coordinator.invokeScopedToolStep({
                  invocation: {
                    sessionId: identities.sessionId,
                    requestId: identities.readRequestId,
                    inputRef: identities.readInputRef,
                  },
                });
                if (read.result.status !== "succeeded") {
                  await supervisor.awaitTerminal(identities.sessionId);
                  await coordinator.finalizeAttempt(identities.sessionId);
                  return;
                }
                if (read.result.outputRef === undefined) {
                  throw new Error("Workspace text read completed without owned content");
                }
                const source = await this.config.persistence.resolveContentReference({
                  contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
                  reference: read.result.outputRef,
                  kind: "tool-output",
                  owner: {
                    workspaceId: identities.workspaceId,
                    taskId: identities.taskId,
                    sessionId: identities.sessionId,
                    workerId: identities.workerId,
                    requestId: identities.readRequestId,
                    grantId: identities.grantId,
                  },
                  resolvedAt: this.config.clock.now(),
                  consume: false,
                });
                if (
                  source.metadata.classification !== "workspace-content" ||
                  source.metadata.mediaType !== "text/plain; charset=utf-8"
                ) {
                  throw new Error("Workspace text read returned unsupported content authority");
                }
                await supervisor.send(identities.sessionId, {
                  messageId: identities.messageId,
                  content: source.content,
                  sentAt: this.config.clock.now(),
                });
                const writeInput = adapter.activeToolInput(identities.requestId);
                if (writeInput === undefined) {
                  throw new Error("General Worker did not provide its private task-output input");
                }
                const serializedWriteInput = serializeScopedNativeToolInput(
                  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
                  writeInput,
                );
                await this.config.persistence.storeContentReference({
                  contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
                  reference: identities.toolInputRef,
                  kind: "tool-input",
                  owner: {
                    workspaceId: identities.workspaceId,
                    taskId: identities.taskId,
                    sessionId: identities.sessionId,
                    workerId: identities.workerId,
                    requestId: identities.requestId,
                    grantId: identities.grantId,
                  },
                  classification: "task-content",
                  mediaType: "text/plain; charset=utf-8",
                  content: serializedWriteInput,
                  createdAt: this.config.clock.now(),
                });
                await coordinator.invokeScopedTool({
                  invocation: {
                    sessionId: identities.sessionId,
                    requestId: identities.requestId,
                    inputRef: identities.toolInputRef,
                  },
                  artifact: {
                    artifactId: identities.artifactId,
                    kind: "file",
                    label:
                      journeyKind === "local-research-artifact"
                        ? "Actestra local research brief"
                        : "Actestra file result",
                  },
                });
                return;
              }
              await coordinator.invokeScopedTool({
                invocation: {
                  sessionId: identities.sessionId,
                  requestId: identities.requestId,
                  inputRef: identities.toolInputRef,
                },
                artifact: {
                  artifactId: identities.artifactId,
                  kind: "file",
                  label: "Actestra result",
                },
              });
              return;
            }
            await supervisor.send(identities.sessionId, {
              messageId: identities.messageId,
              content: prompt,
              sentAt: this.config.clock.now(),
            });
            await supervisor.awaitTerminal(identities.sessionId);
            await coordinator.finalizeAttempt(identities.sessionId);
          } catch (error) {
            await supervisor
              .cancel(
                identities.sessionId,
                "Actestra cancelled the attempt after journey coordination failed.",
              )
              .catch((): undefined => undefined);
            await supervisor.awaitTerminal(identities.sessionId).catch((): undefined => undefined);
            await coordinator
              .finalizeAttempt(identities.sessionId)
              .catch((): undefined => undefined);
            throw error;
          }
        })
        .finally(async () => {
          await adapter.close().catch((): undefined => undefined);
          if (this.activeJourneys.get(identities.taskId) === active) {
            this.activeJourneys.delete(identities.taskId);
          }
        });
      active = Object.freeze({
        adapter,
        supervisor,
        coordinator,
        sessionId: identities.sessionId,
        completion,
      });
      this.activeJourneys.set(identities.taskId, active);
      void completion.catch((): undefined => undefined);
      return projection;
    } catch (error) {
      await adapter.close().catch((): undefined => undefined);
      throw error;
    }
  }

  private async project(task: Task, graph: DomainGraph): Promise<AionUiGeneralWorkProjection> {
    const session = latestSession(task, graph);
    const checkpoint =
      session === undefined
        ? null
        : await this.config.persistence.getGeneralWorkCheckpoint(session.id);
    return this.buildProjection(task, graph, checkpoint);
  }

  private buildProjection(
    task: Task,
    graph: DomainGraph,
    checkpoint: GeneralWorkCheckpoint | null,
  ): AionUiGeneralWorkProjection {
    const session = latestSession(task, graph);
    const artifacts = projectionArtifacts(task, graph);
    const updatedAt = maximumInstant([
      task.updatedAt,
      ...(session === undefined ? [] : [session.updatedAt]),
      ...(checkpoint === null ? [] : [checkpoint.updatedAt]),
      ...artifacts.map((artifact) => artifact.updatedAt),
    ]);
    const summary =
      latestAssistantSummary(checkpoint) ??
      (artifacts.length === 0
        ? undefined
        : `Actestra created ${String(artifacts.length)} task artifact${
            artifacts.length === 1 ? "" : "s"
          }.`);
    const status = checkpoint?.attempt.taskState ?? task.state;
    const incidentCode = checkpoint?.attempt.incident?.code ?? latestFailureCode(checkpoint);
    const projection = Object.freeze({
      contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
      taskId: task.id,
      status,
      title: task.title,
      ...(summary === undefined ? {} : { summary }),
      ...(incidentCode === undefined ? {} : { incidentCode }),
      canCancel: CANCELLABLE_TASK_STATES.has(status),
      createdAt: task.createdAt,
      updatedAt,
      artifacts: Object.freeze(
        artifacts.map((artifact) =>
          Object.freeze({
            artifactId: artifact.id,
            kind: artifact.kind,
            label: artifact.label,
            state: artifact.state,
          }),
        ),
      ),
    }) satisfies AionUiGeneralWorkProjection;
    assertAionUiGeneralWorkProjection(projection);
    return projection;
  }
}
