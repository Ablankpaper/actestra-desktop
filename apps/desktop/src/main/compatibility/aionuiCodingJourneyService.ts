import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
  assertAionUiCodingJourneyProjection,
  assertAionUiCodingJourneySubmitRequest,
  hashAionUiGeneralWorkConversation,
  projectArtifactDelivery,
  AIONUI_CODING_JOURNEY_MAX_PROJECTIONS,
  type AionUiCodingJourneyApprovalProjection,
  type AionUiCodingJourneyDecision,
  type AionUiCodingJourneyMessageProjection,
  type AionUiCodingJourneyProjection,
  type AionUiCodingJourneySubmitRequest,
  type AionUiCodingJourneyToolContent,
  type AionUiCodingJourneyToolProjection,
} from "../../compatibility/aionui";
import {
  CODING_DIFF_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
  approvalActorId,
  approvalId,
  artifactId,
  assertApprovalRequestSnapshot,
  canRetryArtifactDelivery,
  assertDomainGraph,
  compareInstants,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ActestraPersistencePort,
  type AgentClock,
  type ApprovalId,
  type ArtifactId,
  type UserApprovalDecision,
  type ArtifactWorkspaceOperationsPort,
  type AuditRecordId,
  type ApprovalRequestSnapshot,
  type CoreEvent,
  type DomainGraph,
  type TaskId,
} from "../../core";
import type { IsolatedCodingProcessDefinition } from "../privileged/isolatedCodingToolPlatform";
import { withPersistenceMutationBarrier } from "../persistence/persistenceMutationBarrier";
import type {
  AionUiGeneralWorkNativeContext,
  AionUiGeneralWorkNativeContextPort,
} from "./aionuiGeneralWorkNativeContext";
import { canonicalizeAionUiGeneralWorkNativeContext } from "./aionuiGeneralWorkNativeContext";
import type { GooseLoopbackModelInvoker } from "../workers/gooseLoopbackModelServer";
import type {
  GooseCodingApprovalDecision,
  GooseCodingApprovalDecisionRequest,
} from "../workers/gooseCodingToolInvoker";
import { createGooseAcpHumanDecisionGate } from "../workers/gooseAcpHandshake";
import type {
  GooseAcpPromptResult,
  GooseAcpToolCallContent,
  GooseAcpToolKind,
} from "../workers/gooseAcpHandshake";
import type {
  GooseCodingPublishDecision,
  GooseCodingPublishDecisionRequest,
} from "../workers/gooseCodingArtifactPublisher";
import { deriveGooseCodingEvidenceIdentity } from "../workers/gooseCodingEvidenceCoordinator";
import type {
  GooseCodingMainSession,
  IsolatedCodingMainService,
} from "../workers/isolatedCodingMainService";
import type { AdmittedGooseRunnerArtifact } from "../workers/gooseRunnerArtifact";
import { ArtifactDeliveryService } from "../workers/artifactDeliveryService";
import { resolveWorkspaceGitBinding } from "../workers/workspaceGitBinding";

const MAX_TITLE_BYTES = 512;
const TEAM_APPROVAL_ACTOR_ID = approvalActorId("actestra-team-owner");

interface CodingJourneyIdentities {
  readonly conversationHash: string;
  readonly workspaceId: ReturnType<typeof workspaceId>;
  readonly taskId: ReturnType<typeof taskId>;
  readonly sessionId: ReturnType<typeof sessionId>;
  readonly workerId: ReturnType<typeof workerId>;
  readonly grantId: ReturnType<typeof workspaceGrantId>;
}

interface AionUiCodingAgentAdmissionPort {
  requireAdmittedArtifact(): Promise<AdmittedGooseRunnerArtifact>;
}

type AionUiCodingNativeContextResolver = (
  intent: AionUiCodingJourneySubmitRequest,
) => Promise<AionUiGeneralWorkNativeContext>;

export interface AionUiCodingJourneyServiceConfig {
  readonly persistence: ActestraPersistencePort & ArtifactWorkspaceOperationsPort;
  readonly clock: AgentClock;
  readonly nativeContext: AionUiGeneralWorkNativeContextPort;
  readonly codingAgent: AionUiCodingAgentAdmissionPort;
  readonly getMainService: () => IsolatedCodingMainService | null;
  readonly privateRootParent: string;
  readonly modelId: string;
  readonly modelInvoker: GooseLoopbackModelInvoker;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
}

interface ActiveCodingJourney {
  readonly session: GooseCodingMainSession;
  readonly completion: Promise<void>;
  promptResult?: Awaited<ReturnType<GooseCodingMainSession["prompt"]>>;
  retainAfterCompletion?: boolean;
  completionSettled?: boolean;
  closePromise?: Promise<void>;
}

interface PendingToolApproval {
  readonly approval: ApprovalRequestSnapshot;
  readonly toolCallId: string;
  readonly signal: AbortSignal;
  readonly decision: Promise<GooseCodingApprovalDecision>;
  resolve(value: GooseCodingApprovalDecision): void;
  reject(error: Error): void;
}

interface PendingPublishApproval {
  readonly approval: ApprovalRequestSnapshot;
  readonly snapshot: GooseCodingPublishDecisionRequest["snapshot"];
  readonly signal: AbortSignal;
  readonly decision: Promise<GooseCodingPublishDecision>;
  resolve(value: GooseCodingPublishDecision): void;
  reject(error: Error): void;
}

export interface AionUiCodingTeamApprovalEvidence {
  readonly approvalId: ApprovalId;
  readonly policyAuditRecordId: AuditRecordId;
  readonly requestAuditRecordId: AuditRecordId;
  readonly reason: string;
}

export interface AionUiCodingTeamApprovalDecisionEvidence {
  readonly decisionAuditRecordId: AuditRecordId;
}

export interface AionUiCodingTeamApprovalOutcomeEvidence {
  readonly outcomeAuditRecordId: AuditRecordId;
}

export type AionUiCodingTeamApprovalObserver = (
  evidence: AionUiCodingTeamApprovalEvidence,
) => void | Promise<void>;

interface PreparedTeamApprovalDecision {
  readonly approvalId: ApprovalId;
  readonly decision: AionUiCodingJourneyDecision;
  readonly actorId: ReturnType<typeof approvalActorId>;
  readonly decisionAuditRecordId: AuditRecordId;
}

export class AionUiCodingJourneyServiceError extends Error {
  constructor(
    readonly code:
      | "agent-unavailable"
      | "workspace-unavailable"
      | "task-not-owned"
      | "task-conflict"
      | "approval-not-pending"
      | "execution-failed"
      | "artifact-not-found"
      | "delivery-not-found"
      | "delivery-conflict"
      | "apply-failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiCodingJourneyServiceError";
  }
}

function journeyDigest(conversationHash: string, submissionId: string): string {
  return createHash("sha256")
    .update(
      `actestra-aionui-coding\u0000${String(
        AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
      )}\u0000${conversationHash}\u0000${submissionId}`,
    )
    .digest("hex");
}

export function deriveAionUiCodingJourneyIdentities(
  nativeConversationId: string,
  submissionId: string,
): CodingJourneyIdentities {
  const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
  const digest = journeyDigest(conversationHash, submissionId);
  return Object.freeze({
    conversationHash,
    workspaceId: workspaceId(`workspace-aionui-coding-${conversationHash}`),
    taskId: taskId(`task-aionui-coding-${digest}`),
    sessionId: sessionId(`session-aionui-coding-${digest}`),
    workerId: workerId(`worker-aionui-coding-${digest}`),
    grantId: workspaceGrantId(`grant-aionui-coding-${digest}`),
  });
}

function identitiesForTask(conversationHash: string, taskIdValue: TaskId): CodingJourneyIdentities {
  const prefix = "task-aionui-coding-";
  if (!taskIdValue.startsWith(prefix)) {
    throw new AionUiCodingJourneyServiceError(
      "task-not-owned",
      "The requested Task is not an Actestra coding journey",
    );
  }
  const digest = taskIdValue.slice(prefix.length);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new AionUiCodingJourneyServiceError(
      "task-not-owned",
      "The requested coding Task identity is invalid",
    );
  }
  return Object.freeze({
    conversationHash,
    workspaceId: workspaceId(`workspace-aionui-coding-${conversationHash}`),
    taskId: taskIdValue,
    sessionId: sessionId(`session-aionui-coding-${digest}`),
    workerId: workerId(`worker-aionui-coding-${digest}`),
    grantId: workspaceGrantId(`grant-aionui-coding-${digest}`),
  });
}

function identitiesForWorkspaceTask(
  workspaceIdValue: string,
  taskIdValue: TaskId,
): CodingJourneyIdentities {
  const prefix = "workspace-aionui-coding-";
  if (!workspaceIdValue.startsWith(prefix)) {
    throw new AionUiCodingJourneyServiceError(
      "task-not-owned",
      "The requested coding workspace identity is invalid",
    );
  }
  const conversationHash = workspaceIdValue.slice(prefix.length);
  if (!/^[a-f0-9]{64}$/u.test(conversationHash)) {
    throw new AionUiCodingJourneyServiceError(
      "task-not-owned",
      "The requested coding conversation identity is invalid",
    );
  }
  return identitiesForTask(conversationHash, taskIdValue);
}

function toolPresentationForId(toolIdValue: string): Readonly<{
  title: string;
  kind: AionUiCodingJourneyToolProjection["kind"];
  surface: AionUiCodingJourneyToolProjection["surface"];
}> {
  switch (toolIdValue) {
    case CODING_FILE_READ_TOOL_ID:
      return Object.freeze({
        title: "Read isolated workspace file",
        kind: "read",
        surface: "tool",
      });
    case CODING_FILE_WRITE_TOOL_ID:
      return Object.freeze({
        title: "Edit isolated workspace file",
        kind: "edit",
        surface: "diff",
      });
    case CODING_TERMINAL_TOOL_ID:
      return Object.freeze({ title: "Run admitted command", kind: "execute", surface: "terminal" });
    case CODING_GIT_TOOL_ID:
      return Object.freeze({ title: "Inspect isolated Git state", kind: "read", surface: "tool" });
    case CODING_DIFF_TOOL_ID:
      return Object.freeze({ title: "Inspect isolated diff", kind: "read", surface: "diff" });
    case CODING_TEST_TOOL_ID:
      return Object.freeze({
        title: "Run admitted focused test",
        kind: "execute",
        surface: "test",
      });
    default:
      return Object.freeze({
        title: "Use isolated coding capability",
        kind: "execute",
        surface: "tool",
      });
  }
}

function toolPresentation(approval: ApprovalRequestSnapshot) {
  return toolPresentationForId(approval.operation.toolId);
}

function projectToolKind(kind: GooseAcpToolKind): AionUiCodingJourneyToolProjection["kind"] {
  if (kind === "read" || kind === "search" || kind === "fetch") return "read";
  if (kind === "edit" || kind === "delete" || kind === "move") return "edit";
  return "execute";
}

function projectToolContent(
  content: GooseAcpToolCallContent,
): AionUiCodingJourneyToolContent | undefined {
  if (content.type === "content" && "content" in content) {
    const nested = content.content;
    if (
      typeof nested === "object" &&
      nested !== null &&
      "type" in nested &&
      nested.type === "text" &&
      "text" in nested &&
      typeof nested.text === "string" &&
      nested.text.trim().length > 0
    ) {
      return Object.freeze({ type: "content", text: nested.text });
    }
    return undefined;
  }
  if (
    content.type === "diff" &&
    "path" in content &&
    typeof content.path === "string" &&
    "newText" in content &&
    typeof content.newText === "string"
  ) {
    const oldText = "oldText" in content ? content.oldText : undefined;
    return Object.freeze({
      type: "diff",
      path: content.path,
      ...(typeof oldText === "string" || oldText === null ? { oldText } : {}),
      newText: content.newText,
    });
  }
  if (
    content.type === "terminal" &&
    "terminalId" in content &&
    typeof content.terminalId === "string"
  ) {
    return Object.freeze({ type: "terminal", terminalId: content.terminalId });
  }
  return undefined;
}

function projectPromptResult(result: GooseAcpPromptResult): Readonly<{
  messages: readonly AionUiCodingJourneyMessageProjection[];
  tools: readonly AionUiCodingJourneyToolProjection[];
}> {
  const messages = new Map<string, { messageId: string; text: string }>();
  const tools = new Map<
    string,
    {
      toolCallId: string;
      title: string;
      kind: AionUiCodingJourneyToolProjection["kind"];
      status: AionUiCodingJourneyToolProjection["status"];
      content: readonly AionUiCodingJourneyToolContent[];
    }
  >();
  for (const update of result.updates) {
    if (update.type === "agent_message_chunk") {
      const messageId = update.messageId ?? "assistant-coding-response";
      const current = messages.get(messageId);
      messages.set(messageId, {
        messageId,
        text: `${current?.text ?? ""}${update.text}`,
      });
      continue;
    }
    if (update.type !== "tool_call" && update.type !== "tool_call_update") continue;
    const current = tools.get(update.toolCallId);
    const title = update.title ?? current?.title ?? "Coding tool";
    const kind =
      update.kind === undefined ? (current?.kind ?? "execute") : projectToolKind(update.kind);
    const status = update.status ?? current?.status ?? "pending";
    const content =
      update.content === undefined
        ? (current?.content ?? Object.freeze([]))
        : Object.freeze(
            update.content
              .map((item) => projectToolContent(item))
              .filter((item): item is AionUiCodingJourneyToolContent => item !== undefined),
          );
    tools.set(update.toolCallId, {
      toolCallId: update.toolCallId,
      title,
      kind,
      status,
      content,
    });
  }
  return Object.freeze({
    messages: Object.freeze(
      [...messages.values()]
        .filter(({ text }) => text.trim().length > 0)
        .map((message) => Object.freeze(message)),
    ),
    tools: Object.freeze(
      [...tools.values()].map((tool) => {
        const surface: AionUiCodingJourneyToolProjection["surface"] = tool.content.some(
          ({ type }) => type === "terminal",
        )
          ? "terminal"
          : tool.content.some(({ type }) => type === "diff")
            ? "diff"
            : /(?:^|\s)test(?:\s|$)/iu.test(tool.title)
              ? "test"
              : "tool";
        return Object.freeze({ ...tool, surface });
      }),
    ),
  });
}

function projectDurableEvents(events: readonly CoreEvent[]): Readonly<{
  messages: readonly AionUiCodingJourneyMessageProjection[];
  tools: readonly AionUiCodingJourneyToolProjection[];
  incidentCode?: string;
}> {
  const messages: AionUiCodingJourneyMessageProjection[] = [];
  const tools = new Map<string, AionUiCodingJourneyToolProjection>();
  let incidentCode: string | undefined;
  for (const event of events) {
    if (event.type === "agent.message" && event.payload.role === "assistant") {
      if (event.payload.content.trim().length > 0) {
        messages.push(
          Object.freeze({
            messageId: event.eventId,
            text: event.payload.content,
          }),
        );
      }
      continue;
    }
    if (event.type === "tool.requested") {
      const presentation = toolPresentationForId(event.payload.toolName);
      tools.set(
        event.payload.requestId,
        Object.freeze({
          toolCallId: event.payload.requestId,
          title: event.payload.summary,
          kind: presentation.kind,
          status: "pending",
          surface: presentation.surface,
          content: Object.freeze([]),
        }),
      );
      continue;
    }
    if (event.type === "tool.started") {
      const current = tools.get(event.payload.requestId);
      if (current !== undefined) {
        tools.set(event.payload.requestId, Object.freeze({ ...current, status: "in_progress" }));
      }
      continue;
    }
    if (event.type === "tool.completed") {
      const current = tools.get(event.payload.requestId);
      if (current !== undefined) {
        tools.set(
          event.payload.requestId,
          Object.freeze({
            ...current,
            status: "completed",
            content: Object.freeze(
              event.payload.summary === undefined || event.payload.summary.trim().length === 0
                ? []
                : [{ type: "content" as const, text: event.payload.summary }],
            ),
          }),
        );
      }
      continue;
    }
    if (event.type === "tool.failed") {
      const current = tools.get(event.payload.requestId);
      if (current !== undefined) {
        tools.set(
          event.payload.requestId,
          Object.freeze({
            ...current,
            status: "failed",
            content: Object.freeze(
              event.payload.message.trim().length === 0
                ? []
                : [{ type: "content" as const, text: event.payload.message }],
            ),
          }),
        );
      }
      incidentCode = event.payload.errorCode;
      continue;
    }
    if (event.type === "worker.failed" || event.type === "task.failed") {
      incidentCode = event.payload.errorCode;
    }
  }
  return Object.freeze({
    messages: Object.freeze(messages),
    tools: Object.freeze([...tools.values()]),
    ...(incidentCode === undefined ? {} : { incidentCode }),
  });
}

function boundedPresentationText(value: string, maximumBytes: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  let result = "";
  let resultBytes = 0;
  for (const character of normalized) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (resultBytes + characterBytes > maximumBytes) break;
    result += character;
    resultBytes += characterBytes;
  }
  return result;
}

function assertCancellationReason(value: unknown): asserts value is string | undefined {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > 512 ||
    [...value].some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 31 || (point >= 127 && point <= 159));
    })
  ) {
    throw new Error("AionUI coding cancellation reason is invalid");
  }
}

async function requireCanonicalGitRoot(rootPath: string): Promise<string> {
  try {
    const binding = await resolveWorkspaceGitBinding(rootPath);
    if (binding.workspaceRoot !== rootPath) {
      throw new AionUiCodingJourneyServiceError(
        "workspace-unavailable",
        "AionUI coding requires the canonical Git worktree root, and this workspace is a subdirectory of one",
      );
    }
    return rootPath;
  } catch (error) {
    if (error instanceof AionUiCodingJourneyServiceError) throw error;
    throw new AionUiCodingJourneyServiceError(
      "workspace-unavailable",
      "AionUI coding requires one canonical native Git workspace, and this workspace is not a Git repository",
      { cause: error },
    );
  }
}

function graphContainsRegistration(
  graph: DomainGraph,
  identities: CodingJourneyIdentities,
): boolean {
  const workspace = graph.workspaces.find(({ id }) => id === identities.workspaceId);
  const task = graph.tasks.find(({ id }) => id === identities.taskId);
  const session = graph.sessions.find(({ id }) => id === identities.sessionId);
  const worker = graph.workers.find(({ id }) => id === identities.workerId);
  const activeSessionMatches =
    task?.state === "running" || task?.state === "blocked"
      ? task.activeSessionId === identities.sessionId
      : task?.state === "completed" || task?.state === "failed" || task?.state === "cancelled"
        ? task.activeSessionId === undefined
        : false;
  return (
    workspace?.state === "active" &&
    task?.workspaceId === identities.workspaceId &&
    activeSessionMatches &&
    session?.workspaceId === identities.workspaceId &&
    session.taskId === identities.taskId &&
    session.workerId === identities.workerId &&
    worker?.workspaceId === identities.workspaceId &&
    worker.adapterKind === "goose"
  );
}

function maximumInstant(values: readonly ReturnType<typeof instant>[]): ReturnType<typeof instant> {
  return values.reduce((latest, value) => (compareInstants(value, latest) > 0 ? value : latest));
}

export class AionUiCodingJourneyService {
  private readonly submissions = new Map<string, Promise<AionUiCodingJourneyProjection>>();
  private readonly activeJourneys = new Map<string, ActiveCodingJourney>();
  private readonly pendingToolApprovals = new Map<string, PendingToolApproval>();
  private readonly pendingPublishApprovals = new Map<string, PendingPublishApproval>();
  private readonly approvalObservers = new Map<TaskId, Set<AionUiCodingTeamApprovalObserver>>();
  private readonly preparedTeamApprovalDecisions = new Map<TaskId, PreparedTeamApprovalDecision>();
  private readonly journeyFailures = new Map<string, unknown>();
  private readonly pendingTaskIdleWaits = new Map<string, number>();
  private readonly artifactApplyAborts = new Map<ArtifactId, AbortController>();
  /** Built on first apply, so a session that never applies composes no delivery authority. */
  private artifactDeliveryService: ArtifactDeliveryService | undefined;

  constructor(private readonly config: AionUiCodingJourneyServiceConfig) {}

  submit(value: unknown): Promise<AionUiCodingJourneyProjection> {
    return this.submitWithContextResolver(value, (intent) =>
      this.config.nativeContext.resolve(intent.nativeConversationId),
    );
  }

  submitFromTrustedContext(
    value: unknown,
    nativeContext: AionUiGeneralWorkNativeContext,
    destinationWorkspaceId?: ReturnType<typeof workspaceId>,
  ): Promise<AionUiCodingJourneyProjection> {
    const trustedContext = Object.freeze({ ...nativeContext });
    return this.submitWithContextResolver(
      value,
      async () => trustedContext,
      destinationWorkspaceId,
    );
  }

  private submitWithContextResolver(
    value: unknown,
    resolveNativeContext: AionUiCodingNativeContextResolver,
    destinationWorkspaceId?: ReturnType<typeof workspaceId>,
  ): Promise<AionUiCodingJourneyProjection> {
    assertAionUiCodingJourneySubmitRequest(value);
    const intent = Object.freeze({ ...value }) as AionUiCodingJourneySubmitRequest;
    const identities = deriveAionUiCodingJourneyIdentities(
      intent.nativeConversationId,
      intent.submissionId,
    );
    const existing = this.submissions.get(identities.taskId);
    if (existing !== undefined) return existing;
    const operation = this.submitOnce(
      intent,
      identities,
      resolveNativeContext,
      destinationWorkspaceId,
    ).finally(() => {
      if (this.submissions.get(identities.taskId) === operation) {
        this.submissions.delete(identities.taskId);
      }
    });
    this.submissions.set(identities.taskId, operation);
    return operation;
  }

  async list(
    nativeConversationId: string,
    limit = AIONUI_CODING_JOURNEY_MAX_PROJECTIONS,
  ): Promise<readonly AionUiCodingJourneyProjection[]> {
    await this.recoverArtifactDeliveries();
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > AIONUI_CODING_JOURNEY_MAX_PROJECTIONS
    ) {
      throw new Error("AionUI coding-journey projection limit is invalid");
    }
    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    const expectedWorkspaceId = workspaceId(`workspace-aionui-coding-${conversationHash}`);
    const graph = await this.config.persistence.loadDomainGraph();
    const tasks = graph.tasks
      .filter(
        (task) =>
          task.workspaceId === expectedWorkspaceId && task.id.startsWith("task-aionui-coding-"),
      )
      .sort((left, right) => compareInstants(right.createdAt, left.createdAt))
      .slice(0, limit);
    return Object.freeze(
      await Promise.all(
        tasks.map((task) => this.project(identitiesForTask(conversationHash, task.id), graph)),
      ),
    );
  }

  async decideApproval(
    nativeConversationId: string,
    taskIdValue: string,
    approvalIdValue: string,
    decision: AionUiCodingJourneyDecision,
  ): Promise<AionUiCodingJourneyProjection> {
    const identities = await this.requireOwnedTask(nativeConversationId, taskIdValue);
    const stableApprovalId = approvalId(approvalIdValue);
    if (decision !== "approved" && decision !== "denied") {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "AionUI coding approval decision is invalid",
      );
    }
    const pending = this.pendingToolApprovals.get(identities.taskId);
    if (
      pending === undefined ||
      pending.approval.approvalId !== stableApprovalId ||
      pending.signal.aborted
    ) {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "The requested coding tool approval is not pending",
      );
    }
    pending.resolve(
      Object.freeze({
        decision,
        actorId: approvalActorId("actestra-aionui-coding-user"),
      }),
    );
    await Promise.resolve();
    return this.project(identities);
  }

  observeApproval(taskIdValue: string, observer: AionUiCodingTeamApprovalObserver): () => void {
    const stableTaskId = taskId(taskIdValue);
    if (typeof observer !== "function") {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "Team coding approval observer is invalid",
      );
    }
    let observers = this.approvalObservers.get(stableTaskId);
    if (observers === undefined) {
      observers = new Set();
      this.approvalObservers.set(stableTaskId, observers);
    }
    observers.add(observer);
    const pending = this.#pendingTeamApproval(stableTaskId);
    if (pending !== undefined) {
      void this.#notifyApprovalObserver(stableTaskId, pending.approval, observer).catch((error) => {
        pending.reject(
          error instanceof Error
            ? error
            : new AionUiCodingJourneyServiceError(
                "execution-failed",
                "Team approval observer failed",
              ),
        );
      });
    }
    return () => {
      const retained = this.approvalObservers.get(stableTaskId);
      retained?.delete(observer);
      if (retained?.size === 0) this.approvalObservers.delete(stableTaskId);
    };
  }

  async prepareTeamApprovalDecision(
    taskIdValue: string,
    approvalIdValue: string,
    decision: AionUiCodingJourneyDecision,
  ): Promise<AionUiCodingTeamApprovalDecisionEvidence> {
    const stableTaskId = taskId(taskIdValue);
    const stableApprovalId = approvalId(approvalIdValue);
    if (decision !== "approved" && decision !== "denied") {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "Team coding approval decision is invalid",
      );
    }
    const pending = this.#requirePendingTeamApproval(stableTaskId, stableApprovalId);
    const existing = this.preparedTeamApprovalDecisions.get(stableTaskId);
    if (existing !== undefined) {
      if (existing.approvalId !== stableApprovalId || existing.decision !== decision) {
        throw new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "Team coding approval decision conflicts with the recorded decision",
        );
      }
      return Object.freeze({ decisionAuditRecordId: existing.decisionAuditRecordId });
    }
    const session = this.#requireActiveSession(stableTaskId);
    const decisionAuditRecordId = await session.approvalAuditEvidence.recordDecision(
      pending.approval,
      decision,
      TEAM_APPROVAL_ACTOR_ID,
    );
    this.preparedTeamApprovalDecisions.set(
      stableTaskId,
      Object.freeze({
        approvalId: stableApprovalId,
        decision,
        actorId: TEAM_APPROVAL_ACTOR_ID,
        decisionAuditRecordId,
      }),
    );
    return Object.freeze({ decisionAuditRecordId });
  }

  async commitTeamApprovalDecision(
    taskIdValue: string,
    approvalIdValue: string,
    decision: AionUiCodingJourneyDecision,
    persistOutcome: (evidence: AionUiCodingTeamApprovalOutcomeEvidence) => Promise<void>,
  ): Promise<AionUiCodingJourneyProjection> {
    const stableTaskId = taskId(taskIdValue);
    const stableApprovalId = approvalId(approvalIdValue);
    if (
      (decision !== "approved" && decision !== "denied") ||
      typeof persistOutcome !== "function"
    ) {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "Team coding approval outcome request is invalid",
      );
    }
    const pending = this.#requirePendingTeamApproval(stableTaskId, stableApprovalId);
    const prepared = this.preparedTeamApprovalDecisions.get(stableTaskId);
    if (
      prepared === undefined ||
      prepared.approvalId !== stableApprovalId ||
      prepared.decision !== decision ||
      prepared.actorId !== TEAM_APPROVAL_ACTOR_ID
    ) {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "Team coding approval outcome has no matching persisted decision",
      );
    }
    const session = this.#requireActiveSession(stableTaskId);
    let resolved: ApprovalRequestSnapshot;
    try {
      resolved = await session.approvalService.resolve(
        stableApprovalId,
        decision,
        TEAM_APPROVAL_ACTOR_ID,
      );
    } catch (error) {
      const committed = await session.approvalService.get(stableApprovalId);
      if (
        committed === undefined ||
        !this.#matchesTeamApprovalResolution(
          committed,
          pending.approval,
          decision,
          TEAM_APPROVAL_ACTOR_ID,
        )
      ) {
        throw error;
      }
      resolved = committed;
    }
    if (
      !this.#matchesTeamApprovalResolution(
        resolved,
        pending.approval,
        decision,
        TEAM_APPROVAL_ACTOR_ID,
      )
    ) {
      throw new AionUiCodingJourneyServiceError(
        "execution-failed",
        "Team coding ApprovalService returned mismatched resolution evidence",
      );
    }
    const outcomeAuditRecordId = session.approvalAuditEvidence.resolution(
      pending.approval,
      decision,
      TEAM_APPROVAL_ACTOR_ID,
    );
    await persistOutcome(Object.freeze({ outcomeAuditRecordId }));
    pending.resolve(Object.freeze({ decision, actorId: TEAM_APPROVAL_ACTOR_ID }));
    this.preparedTeamApprovalDecisions.delete(stableTaskId);
    await Promise.resolve();
    return this.project(
      identitiesForWorkspaceTask(pending.approval.operation.workspaceId, stableTaskId),
    );
  }

  async decidePublish(
    nativeConversationId: string,
    taskIdValue: string,
    approvalIdValue: string,
    decision: AionUiCodingJourneyDecision,
  ): Promise<AionUiCodingJourneyProjection> {
    const identities = await this.requireOwnedTask(nativeConversationId, taskIdValue);
    const stableApprovalId = approvalId(approvalIdValue);
    if (decision !== "approved" && decision !== "denied") {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "AionUI coding publish decision is invalid",
      );
    }
    const pending = this.pendingPublishApprovals.get(identities.taskId);
    if (
      pending === undefined ||
      pending.approval.approvalId !== stableApprovalId ||
      pending.signal.aborted
    ) {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "The requested coding publish approval is not pending",
      );
    }
    pending.resolve(
      Object.freeze({
        decision,
        actorId: approvalActorId("actestra-aionui-coding-user"),
      }),
    );
    await Promise.resolve();
    return this.project(identities);
  }

  async cancel(
    nativeConversationId: string,
    taskIdValue: string,
    reason?: string,
  ): Promise<AionUiCodingJourneyProjection> {
    assertCancellationReason(reason);
    const identities = await this.requireOwnedTask(nativeConversationId, taskIdValue);
    const current = await this.project(identities);
    if (!current.canCancel) return current;
    const active = this.activeJourneys.get(identities.taskId);
    if (active === undefined) {
      throw new AionUiCodingJourneyServiceError(
        "task-conflict",
        "The coding Task has no active isolated Goose session",
      );
    }
    await this.closeActiveJourney(active);
    await active.completion;
    this.journeyFailures.delete(identities.taskId);
    return this.project(identities);
  }

  private async requireOwnedTask(
    nativeConversationId: string,
    taskIdValue: string,
  ): Promise<CodingJourneyIdentities> {
    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    const identities = identitiesForTask(conversationHash, taskId(taskIdValue));
    const graph = await this.config.persistence.loadDomainGraph();
    if (!graphContainsRegistration(graph, identities)) {
      throw new AionUiCodingJourneyServiceError(
        "task-not-owned",
        "AionUI conversation does not own the requested coding Task",
      );
    }
    return identities;
  }

  private async terminalizeOpeningFailure(identities: CodingJourneyIdentities): Promise<void> {
    await withPersistenceMutationBarrier(this.config.persistence, async () => {
      const graph = await this.config.persistence.loadDomainGraph();
      if (!graphContainsRegistration(graph, identities)) {
        throw new AionUiCodingJourneyServiceError(
          "task-conflict",
          "AionUI coding opening failure lost its authoritative registration",
        );
      }
      const now = this.config.clock.now();
      const next: DomainGraph = {
        ...graph,
        tasks: graph.tasks.map((task) =>
          task.id !== identities.taskId ||
          task.state === "completed" ||
          task.state === "failed" ||
          task.state === "cancelled"
            ? task
            : Object.freeze({
                ...task,
                state: "failed" as const,
                activeSessionId: undefined,
                updatedAt: maximumInstant([task.updatedAt, now]),
              }),
        ),
        sessions: graph.sessions.map((session) =>
          session.id !== identities.sessionId ||
          session.state === "completed" ||
          session.state === "failed" ||
          session.state === "cancelled"
            ? session
            : Object.freeze({
                ...session,
                state: "failed" as const,
                updatedAt: maximumInstant([session.updatedAt, now]),
              }),
        ),
        workers: graph.workers.map((worker) =>
          worker.id !== identities.workerId ||
          worker.state === "stopped" ||
          worker.state === "crashed"
            ? worker
            : Object.freeze({
                ...worker,
                state: "crashed" as const,
                updatedAt: maximumInstant([worker.updatedAt, now]),
              }),
        ),
      };
      assertDomainGraph(next);
      await this.config.persistence.replaceDomainGraph(next);
    });
  }

  private awaitToolApprovalDecision(
    taskIdValue: TaskId,
    request: GooseCodingApprovalDecisionRequest,
  ): Promise<GooseCodingApprovalDecision> {
    assertApprovalRequestSnapshot(request.approval);
    if (request.approval.operation.taskId !== taskIdValue) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "task-conflict",
          "Goose coding approval changed the active Task identity",
        ),
      );
    }
    if (this.pendingToolApprovals.has(taskIdValue)) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "task-conflict",
          "A coding Task cannot expose two concurrent approvals",
        ),
      );
    }
    if (request.signal.aborted) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "The coding tool approval was cancelled before projection",
        ),
      );
    }
    let resolveDecision!: (value: GooseCodingApprovalDecision) => void;
    let rejectDecision!: (error: Error) => void;
    const decision = new Promise<GooseCodingApprovalDecision>((resolve, reject) => {
      resolveDecision = resolve;
      rejectDecision = reject;
    });
    const pending: PendingToolApproval = Object.freeze({
      approval: request.approval,
      toolCallId: request.toolCallRequestId,
      signal: request.signal,
      decision,
      resolve: resolveDecision,
      reject: rejectDecision,
    });
    const onAbort = (): void => {
      pending.reject(
        new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "The coding tool approval was cancelled before a decision",
        ),
      );
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    this.pendingToolApprovals.set(taskIdValue, pending);
    return this.#notifyTeamApproval(taskIdValue, pending.approval)
      .then(() => decision)
      .finally(() => {
        request.signal.removeEventListener("abort", onAbort);
        if (this.pendingToolApprovals.get(taskIdValue) === pending) {
          this.pendingToolApprovals.delete(taskIdValue);
        }
        this.preparedTeamApprovalDecisions.delete(taskIdValue);
      });
  }

  private awaitPublishDecision(
    taskIdValue: TaskId,
    request: GooseCodingPublishDecisionRequest,
  ): Promise<GooseCodingPublishDecision> {
    assertApprovalRequestSnapshot(request.approval);
    if (
      request.approval.operation.taskId !== taskIdValue ||
      request.approval.operation.action !== "publish.execute"
    ) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "task-conflict",
          "Coding publish approval changed the active Task authority",
        ),
      );
    }
    if (this.pendingPublishApprovals.has(taskIdValue)) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "task-conflict",
          "A coding Task cannot expose two concurrent publish approvals",
        ),
      );
    }
    if (request.signal.aborted) {
      return Promise.reject(
        new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "The coding publish approval was cancelled before projection",
        ),
      );
    }
    let resolveDecision!: (value: GooseCodingPublishDecision) => void;
    let rejectDecision!: (error: Error) => void;
    const decision = new Promise<GooseCodingPublishDecision>((resolve, reject) => {
      resolveDecision = resolve;
      rejectDecision = reject;
    });
    const pending: PendingPublishApproval = Object.freeze({
      approval: request.approval,
      snapshot: Object.freeze({ ...request.snapshot }),
      signal: request.signal,
      decision,
      resolve: resolveDecision,
      reject: rejectDecision,
    });
    const onAbort = (): void => {
      pending.reject(
        new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "The coding publish approval was cancelled before a decision",
        ),
      );
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    this.pendingPublishApprovals.set(taskIdValue, pending);
    return this.#notifyTeamApproval(taskIdValue, pending.approval)
      .then(() => decision)
      .finally(() => {
        request.signal.removeEventListener("abort", onAbort);
        if (this.pendingPublishApprovals.get(taskIdValue) === pending) {
          this.pendingPublishApprovals.delete(taskIdValue);
        }
        this.preparedTeamApprovalDecisions.delete(taskIdValue);
      });
  }

  private closeActiveJourney(active: ActiveCodingJourney): Promise<void> {
    if (active.closePromise !== undefined) return active.closePromise;
    const closePromise = Promise.resolve()
      .then(() => active.session.close())
      .then(
        () => {
          active.retainAfterCompletion = false;
        },
        (error: unknown) => {
          active.closePromise = undefined;
          active.retainAfterCompletion = true;
          throw error;
        },
      );
    active.closePromise = closePromise;
    return closePromise;
  }

  async waitForIdle(taskIdValue?: string): Promise<void> {
    if (taskIdValue !== undefined) {
      const stableTaskId = taskId(taskIdValue);
      this.pendingTaskIdleWaits.set(
        stableTaskId,
        (this.pendingTaskIdleWaits.get(stableTaskId) ?? 0) + 1,
      );
      try {
        while (true) {
          const active = this.activeJourneys.get(stableTaskId);
          if (active === undefined || active.completionSettled === true) break;
          await Promise.allSettled([active.completion]);
        }
        const failure = this.journeyFailures.get(stableTaskId);
        if (failure !== undefined) {
          this.journeyFailures.delete(stableTaskId);
          throw failure;
        }
      } finally {
        const pending = this.pendingTaskIdleWaits.get(stableTaskId) ?? 0;
        if (pending <= 1) {
          this.pendingTaskIdleWaits.delete(stableTaskId);
        } else {
          this.pendingTaskIdleWaits.set(stableTaskId, pending - 1);
        }
      }
      return;
    }
    while (true) {
      const active = [...this.activeJourneys.values()]
        .filter(({ completionSettled }) => completionSettled !== true)
        .map(({ completion }) => completion);
      if (active.length === 0) break;
      await Promise.allSettled(active);
    }
    let firstFailure: unknown;
    for (const [stableTaskId, failure] of this.journeyFailures) {
      if ((this.pendingTaskIdleWaits.get(stableTaskId) ?? 0) > 0) continue;
      this.journeyFailures.delete(stableTaskId);
      firstFailure ??= failure;
    }
    if (firstFailure !== undefined) throw firstFailure;
  }

  async close(): Promise<void> {
    const active = [...this.activeJourneys.entries()];
    for (const controller of this.artifactApplyAborts.values()) {
      controller.abort();
    }
    this.artifactApplyAborts.clear();
    const closeOutcomes = await Promise.allSettled(
      active.map(([, journey]) => this.closeActiveJourney(journey)),
    );
    await Promise.allSettled(active.map(([, { completion }]) => completion));
    for (const [index, [stableTaskId, journey]] of active.entries()) {
      const outcome = closeOutcomes[index];
      if (outcome.status === "fulfilled" && this.activeJourneys.get(stableTaskId) === journey) {
        journey.retainAfterCompletion = false;
        this.activeJourneys.delete(stableTaskId);
      }
    }
    this.approvalObservers.clear();
    this.preparedTeamApprovalDecisions.clear();
  }

  async getArtifactPatchPreview(artifactIdValue: string): Promise<string> {
    return this.config.persistence.getArtifactPatchPreview(artifactId(artifactIdValue));
  }

  async getArtifactPatchContent(artifactIdValue: string): Promise<string> {
    return this.config.persistence.getArtifactPatchContent(artifactId(artifactIdValue));
  }

  async applyArtifactToWorkspace(
    artifactIdValue: string,
    workspaceRoot: string,
  ): Promise<{ readonly verifiedHead: string }> {
    return this.config.persistence.applyArtifactToWorkspace(
      artifactId(artifactIdValue),
      workspaceRoot,
    );
  }

  async viewArtifact(artifactIdValue: string): Promise<{
    readonly baseCommit: string;
    readonly changedFileCount: number;
    readonly patchPreview: string;
  }> {
    const preview = await this.getArtifactPatchPreview(artifactIdValue);
    const delivery = await this.config.persistence.getArtifactDelivery(artifactId(artifactIdValue));
    if (delivery === null) {
      throw new AionUiCodingJourneyServiceError(
        "artifact-not-found",
        "Artifact delivery record not found",
      );
    }
    return {
      baseCommit: delivery.baseCommit,
      changedFileCount: delivery.changedFileCount,
      patchPreview: preview,
    };
  }

  async downloadArtifact(artifactIdValue: string): Promise<{
    readonly fileName: string;
    readonly content: string;
  }> {
    const content = await this.getArtifactPatchContent(artifactIdValue);
    const graph = await this.config.persistence.loadDomainGraph();
    const artifact = graph.artifacts.find(({ id }) => id === artifactId(artifactIdValue));
    if (artifact === undefined) {
      throw new AionUiCodingJourneyServiceError("artifact-not-found", "Artifact not found");
    }
    const fileName = `${artifact.label.replace(/[^a-zA-Z0-9-]/g, "-")}.patch`;
    return {
      fileName,
      content,
    };
  }

  async applyArtifact(artifactIdValue: string): Promise<{ readonly approvalId: string }> {
    const artifactIdBranded = artifactId(artifactIdValue);
    const deliveryService = this.#deliveryService();
    const inFlight = deliveryService.inFlightApply(artifactIdBranded);
    if (inFlight !== undefined) {
      return Object.freeze({ approvalId: inFlight.approvalId });
    }
    await this.recoverArtifactDeliveries();
    const delivery = await this.config.persistence.getArtifactDelivery(artifactIdBranded);
    if (delivery === null) {
      throw new AionUiCodingJourneyServiceError(
        "artifact-not-found",
        "Artifact delivery record not found",
      );
    }
    if (!canRetryArtifactDelivery(delivery.state)) {
      throw new AionUiCodingJourneyServiceError(
        "delivery-conflict",
        `Artifact delivery is ${delivery.state}, not retryable`,
      );
    }
    const destinationWorkspaceId = delivery.destinationWorkspaceId ?? delivery.workspaceId;
    const grant = await this.config.persistence.getActiveWorkspaceGrant(destinationWorkspaceId);
    if (grant === null) {
      throw new AionUiCodingJourneyServiceError(
        "workspace-unavailable",
        "No active workspace grant found for artifact",
      );
    }

    // The destination authority is the user's own active workspace grant, never the isolated worktree
    // grant that produced the patch. No coding session is opened: opening one would create a fresh
    // worktree and rebind this grant to it, so the approval would name a throwaway copy while the
    // write landed in the user's repository.
    const request = await deliveryService.requestApply({
      artifactId: artifactIdBranded,
      destinationGrant: grant,
      signal: this.#applyAbort(artifactIdBranded).signal,
    });

    // Completion settles in background; user sees approval card immediately
    request.completion.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AionUiCodingJourneyService] Apply completion failed: ${message}`, error);
    });

    return Object.freeze({ approvalId: request.approvalId });
  }

  /**
   * Records a user decision on a pending apply approval. The write only happens once this is called
   * with `approved`; nothing about clicking "apply" authorizes it.
   */
  async resolveArtifactApply(
    approvalIdValue: string,
    decision: UserApprovalDecision,
  ): Promise<void> {
    await this.#deliveryService().resolveApply(approvalId(approvalIdValue), decision);
  }

  /** Startup/reconnect hook: settle interrupted Main-owned apply attempts before projection or retry. */
  async recoverArtifactDeliveries(): Promise<void> {
    await this.#deliveryService().recoverInterruptedApplies();
  }

  #deliveryService(): ArtifactDeliveryService {
    this.artifactDeliveryService ??= new ArtifactDeliveryService({
      persistence: this.config.persistence,
      clock: this.config.clock,
    });
    return this.artifactDeliveryService;
  }

  /** One abort controller per artifact, so cancelling one apply never cancels another. */
  #applyAbort(artifactIdValue: ArtifactId): AbortController {
    const existing = this.artifactApplyAborts.get(artifactIdValue);
    if (existing !== undefined && !existing.signal.aborted) {
      return existing;
    }
    const controller = new AbortController();
    this.artifactApplyAborts.set(artifactIdValue, controller);
    return controller;
  }

  #pendingTeamApproval(
    taskIdValue: TaskId,
  ): PendingToolApproval | PendingPublishApproval | undefined {
    return (
      this.pendingToolApprovals.get(taskIdValue) ?? this.pendingPublishApprovals.get(taskIdValue)
    );
  }

  #requirePendingTeamApproval(
    taskIdValue: TaskId,
    approvalIdValue: ApprovalId,
  ): PendingToolApproval | PendingPublishApproval {
    const pending = this.#pendingTeamApproval(taskIdValue);
    if (
      pending === undefined ||
      pending.approval.approvalId !== approvalIdValue ||
      pending.signal.aborted
    ) {
      throw new AionUiCodingJourneyServiceError(
        "approval-not-pending",
        "The requested Team coding approval is not pending",
      );
    }
    return pending;
  }

  #requireActiveSession(taskIdValue: TaskId): GooseCodingMainSession {
    const session = this.activeJourneys.get(taskIdValue)?.session;
    if (session === undefined) {
      throw new AionUiCodingJourneyServiceError(
        "task-conflict",
        "The Team coding approval has no active isolated Goose session",
      );
    }
    return session;
  }

  async #notifyApprovalObserver(
    taskIdValue: TaskId,
    approval: ApprovalRequestSnapshot,
    observer: AionUiCodingTeamApprovalObserver,
  ): Promise<void> {
    const session = this.#requireActiveSession(taskIdValue);
    const evidence = session.approvalAuditEvidence.pending(approval);
    await observer(
      Object.freeze({
        approvalId: approval.approvalId,
        policyAuditRecordId: evidence.policyAuditRecordId,
        requestAuditRecordId: evidence.requestAuditRecordId,
        reason: approval.operation.summary,
      }),
    );
  }

  async #notifyTeamApproval(taskIdValue: TaskId, approval: ApprovalRequestSnapshot): Promise<void> {
    const observers = [...(this.approvalObservers.get(taskIdValue) ?? [])];
    await Promise.all(
      observers.map((observer) => this.#notifyApprovalObserver(taskIdValue, approval, observer)),
    );
  }

  #matchesTeamApprovalResolution(
    resolved: ApprovalRequestSnapshot,
    pending: ApprovalRequestSnapshot,
    decision: "approved" | "denied",
    actorId: ReturnType<typeof approvalActorId>,
  ): boolean {
    try {
      assertApprovalRequestSnapshot(resolved);
    } catch {
      return false;
    }
    return (
      resolved.approvalId === pending.approvalId &&
      resolved.policyRevision === pending.policyRevision &&
      resolved.requestedAt === pending.requestedAt &&
      resolved.expiresAt === pending.expiresAt &&
      resolved.state === decision &&
      resolved.resolvedBy === actorId &&
      isDeepStrictEqual(resolved.operation, pending.operation)
    );
  }

  private async submitOnce(
    intent: AionUiCodingJourneySubmitRequest,
    identities: CodingJourneyIdentities,
    resolveNativeContext: AionUiCodingNativeContextResolver,
    destinationWorkspaceId?: ReturnType<typeof workspaceId>,
  ): Promise<AionUiCodingJourneyProjection> {
    const nativeContext = await canonicalizeAionUiGeneralWorkNativeContext(
      await resolveNativeContext(intent),
    );
    const repositoryRoot = await requireCanonicalGitRoot(nativeContext.rootPath);
    const mainService = this.config.getMainService();
    if (mainService === null) {
      throw new AionUiCodingJourneyServiceError(
        "agent-unavailable",
        "Actestra coding main authority is unavailable",
      );
    }
    let artifact: AdmittedGooseRunnerArtifact;
    try {
      artifact = await this.config.codingAgent.requireAdmittedArtifact();
    } catch (error) {
      throw new AionUiCodingJourneyServiceError(
        "agent-unavailable",
        "The admitted Goose coding worker is unavailable",
        { cause: error },
      );
    }

    let alreadyRegistered = false;
    await withPersistenceMutationBarrier(this.config.persistence, async () => {
      const graph = await this.config.persistence.loadDomainGraph();
      const existingTask = graph.tasks.find(({ id }) => id === identities.taskId);
      if (existingTask !== undefined) {
        if (!graphContainsRegistration(graph, identities)) {
          throw new AionUiCodingJourneyServiceError(
            "task-conflict",
            "AionUI coding submission identity conflicts with authoritative state",
          );
        }
        alreadyRegistered = true;
        return;
      }
      const now = this.config.clock.now();
      instant(now);
      const existingWorkspace = graph.workspaces.find(({ id }) => id === identities.workspaceId);
      const next: DomainGraph = {
        ...graph,
        workspaces:
          existingWorkspace === undefined
            ? [
                ...graph.workspaces,
                Object.freeze({
                  id: identities.workspaceId,
                  name: nativeContext.displayName,
                  state: "active" as const,
                  createdAt: now,
                  updatedAt: now,
                }),
              ]
            : graph.workspaces,
        tasks: [
          ...graph.tasks,
          Object.freeze({
            id: identities.taskId,
            workspaceId: identities.workspaceId,
            title: boundedPresentationText(intent.prompt, MAX_TITLE_BYTES),
            state: "running" as const,
            activeSessionId: identities.sessionId,
            createdAt: now,
            updatedAt: now,
          }),
        ],
        sessions: [
          ...graph.sessions,
          Object.freeze({
            id: identities.sessionId,
            workspaceId: identities.workspaceId,
            taskId: identities.taskId,
            workerId: identities.workerId,
            state: "running" as const,
            createdAt: now,
            updatedAt: now,
          }),
        ],
        workers: [
          ...graph.workers,
          Object.freeze({
            id: identities.workerId,
            workspaceId: identities.workspaceId,
            adapterKind: "goose",
            state: "busy" as const,
            createdAt: now,
            updatedAt: now,
          }),
        ],
      };
      assertDomainGraph(next);
      await this.config.persistence.replaceDomainGraph(next);
    });

    if (alreadyRegistered) {
      return this.project(identities);
    }

    const humanDecisionGate = createGooseAcpHumanDecisionGate();
    let session: GooseCodingMainSession;
    try {
      session = await mainService.openGoose({
        repositoryRoot,
        workspaceId: identities.workspaceId,
        grantId: identities.grantId,
        displayName: nativeContext.displayName,
        commands: this.config.commands,
        tests: this.config.tests,
        artifact,
        privateRootParent: this.config.privateRootParent,
        modelId: this.config.modelId,
        modelInvoker: this.config.modelInvoker,
        taskId: identities.taskId,
        sessionId: identities.sessionId,
        workerId: identities.workerId,
        destinationWorkspaceId,
        approvalDecisionHandler: (request) =>
          this.awaitToolApprovalDecision(identities.taskId, request),
        holdHumanDecision: () => humanDecisionGate.hold(),
      });
    } catch (error) {
      let cause: unknown = error;
      try {
        await this.terminalizeOpeningFailure(identities);
      } catch (terminalizationError) {
        cause = new AggregateError(
          [error, terminalizationError],
          "Actestra coding opening and terminalization both failed",
        );
      }
      throw new AionUiCodingJourneyServiceError(
        "execution-failed",
        "Actestra could not open the isolated Goose coding session",
        { cause },
      );
    }

    let active!: ActiveCodingJourney;
    const completion = session
      .prompt({ text: intent.prompt, humanDecisionGate })
      .then(async (result) => {
        active.promptResult = result;
        if (result.stopReason === "cancelled") {
          await this.closeActiveJourney(active);
          return;
        }
        const publishResult = await session.publish({
          decisionHandler: (request) => this.awaitPublishDecision(identities.taskId, request),
        });
        if (publishResult.status === "published" || publishResult.status === "unchanged") {
          await this.closeActiveJourney(active);
        } else {
          active.retainAfterCompletion = true;
        }
      })
      .catch(async (error: unknown): Promise<void> => {
        if (!this.journeyFailures.has(identities.taskId)) {
          this.journeyFailures.set(identities.taskId, error);
        }
        await this.closeActiveJourney(active).catch((): undefined => undefined);
      })
      .finally(() => {
        active.completionSettled = true;
        if (
          !active.retainAfterCompletion &&
          this.activeJourneys.get(identities.taskId) === active
        ) {
          this.activeJourneys.delete(identities.taskId);
        }
      });
    active = { session, completion };
    this.activeJourneys.set(identities.taskId, active);
    void completion.catch((): undefined => undefined);
    return this.project(identities);
  }

  private async project(
    identities: CodingJourneyIdentities,
    loadedGraph?: DomainGraph,
  ): Promise<AionUiCodingJourneyProjection> {
    const graph = loadedGraph ?? (await this.config.persistence.loadDomainGraph());
    const task = graph.tasks.find(({ id }) => id === identities.taskId);
    const session = graph.sessions.find(({ id }) => id === identities.sessionId);
    const worker = graph.workers.find(({ id }) => id === identities.workerId);
    if (task === undefined || session === undefined || worker === undefined) {
      throw new AionUiCodingJourneyServiceError(
        "task-conflict",
        "AionUI coding task projection is incomplete",
      );
    }
    const artifacts = graph.artifacts.filter(({ taskId: owner }) => owner === task.id);
    const deliveryRecords = await Promise.all(
      artifacts.map((artifact) => this.config.persistence.getArtifactDelivery(artifact.id)),
    );
    const deliveryMap = new Map(
      artifacts
        .map((artifact, index) => [artifact.id, deliveryRecords[index]] as const)
        .filter(([, delivery]) => delivery !== null),
    );
    const evidenceIdentity = deriveGooseCodingEvidenceIdentity({
      workspaceId: identities.workspaceId,
      taskId: identities.taskId,
      sessionId: identities.sessionId,
      workerId: identities.workerId,
    });
    const events = await this.config.persistence.replayEvents(evidenceIdentity.streamId);
    const durableProjection = projectDurableEvents(events);
    const active = this.activeJourneys.get(task.id);
    const liveProjection =
      active?.promptResult === undefined
        ? Object.freeze({
            messages: Object.freeze([]) as readonly AionUiCodingJourneyMessageProjection[],
            tools: Object.freeze([]) as readonly AionUiCodingJourneyToolProjection[],
          })
        : projectPromptResult(active.promptResult);
    const richProjection = Object.freeze({
      messages:
        liveProjection.messages.length > 0 ? liveProjection.messages : durableProjection.messages,
      tools: Object.freeze([
        ...new Map(
          [...durableProjection.tools, ...liveProjection.tools].map((tool) => [
            tool.toolCallId,
            tool,
          ]),
        ).values(),
      ]),
    });
    const pendingToolApproval = this.pendingToolApprovals.get(task.id);
    const pendingPublishApproval = this.pendingPublishApprovals.get(task.id);
    const presentation =
      pendingToolApproval === undefined
        ? undefined
        : toolPresentation(pendingToolApproval.approval);
    const toolApproval =
      pendingToolApproval === undefined || presentation === undefined
        ? undefined
        : (Object.freeze({
            kind: "tool",
            approvalId: pendingToolApproval.approval.approvalId,
            toolCallId: pendingToolApproval.toolCallId,
            title: presentation.title,
            operationKind: presentation.kind,
            summary: pendingToolApproval.approval.operation.summary,
          }) satisfies AionUiCodingJourneyApprovalProjection);
    const publishApproval =
      pendingPublishApproval === undefined
        ? undefined
        : (Object.freeze({
            kind: "publish",
            approvalId: pendingPublishApproval.approval.approvalId,
            toolCallId: pendingPublishApproval.approval.operation.requestId,
            title: "Save Actestra coding patch",
            operationKind: "execute",
            summary: pendingPublishApproval.approval.operation.summary,
            snapshot: pendingPublishApproval.snapshot,
          }) satisfies AionUiCodingJourneyApprovalProjection);
    const approval = publishApproval ?? toolApproval;
    const pendingTool =
      pendingToolApproval === undefined || presentation === undefined
        ? undefined
        : (Object.freeze({
            toolCallId: pendingToolApproval.toolCallId,
            title: presentation.title,
            kind: presentation.kind,
            status: "pending",
            surface: presentation.surface,
            content: Object.freeze([]),
          }) satisfies AionUiCodingJourneyToolProjection);
    const pendingPublishTool =
      pendingPublishApproval === undefined
        ? undefined
        : (Object.freeze({
            toolCallId: pendingPublishApproval.approval.operation.requestId,
            title: "Save Actestra coding patch",
            kind: "execute",
            status: "pending",
            surface: "diff",
            content: Object.freeze([]),
          }) satisfies AionUiCodingJourneyToolProjection);
    const stage =
      task.state === "completed"
        ? "published"
        : task.state === "cancelled"
          ? "cancelled"
          : task.state === "failed"
            ? "failed"
            : publishApproval !== undefined
              ? "publish-approval-required"
              : toolApproval !== undefined
                ? "approval-required"
                : task.state === "blocked"
                  ? "review"
                  : "working";
    const projection = Object.freeze({
      contractVersion: AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
      taskId: task.id,
      status: task.state,
      stage,
      title: task.title,
      canCancel: task.state === "running" || task.state === "blocked",
      createdAt: task.createdAt,
      updatedAt: maximumInstant([
        task.updatedAt,
        session.updatedAt,
        worker.updatedAt,
        ...artifacts.map(({ updatedAt }) => updatedAt),
        ...events.map(({ occurredAt }) => occurredAt),
      ]),
      messages: richProjection.messages,
      tools: Object.freeze([
        ...new Map(
          [
            ...richProjection.tools,
            ...(pendingTool === undefined ? [] : [pendingTool]),
            ...(pendingPublishTool === undefined ? [] : [pendingPublishTool]),
          ].map((tool) => [tool.toolCallId, tool]),
        ).values(),
      ]),
      ...(approval === undefined ? {} : { approval }),
      ...(durableProjection.incidentCode === undefined
        ? {}
        : { incidentCode: durableProjection.incidentCode }),
      artifacts: Object.freeze(
        artifacts.map((artifact) => {
          const delivery = deliveryMap.get(artifact.id);
          if (delivery === undefined || delivery === null) {
            return Object.freeze({
              artifactId: artifact.id,
              label: artifact.label,
              state: artifact.state,
            });
          }
          return Object.freeze({
            artifactId: artifact.id,
            label: artifact.label,
            state: artifact.state,
            delivery: projectArtifactDelivery(delivery),
          });
        }),
      ),
    }) satisfies AionUiCodingJourneyProjection;
    assertAionUiCodingJourneyProjection(projection);
    return projection;
  }
}
