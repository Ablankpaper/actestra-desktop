import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
  assertAionUiCodingJourneyProjection,
  assertAionUiCodingJourneySubmitRequest,
  hashAionUiGeneralWorkConversation,
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
  assertApprovalRequestSnapshot,
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
  type ApprovalRequestSnapshot,
  type CoreEvent,
  type DomainGraph,
  type TaskId,
} from "../../core";
import type { IsolatedCodingProcessDefinition } from "../privileged/isolatedCodingToolPlatform";
import { withPersistenceMutationBarrier } from "../persistence/persistenceMutationBarrier";
import type { AionUiGeneralWorkNativeContextPort } from "./aionuiGeneralWorkNativeContext";
import { canonicalizeAionUiGeneralWorkNativeContext } from "./aionuiGeneralWorkNativeContext";
import type { GooseLoopbackModelInvoker } from "../workers/gooseLoopbackModelServer";
import type {
  GooseCodingApprovalDecision,
  GooseCodingApprovalDecisionRequest,
} from "../workers/gooseCodingToolInvoker";
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

const execFileAsync = promisify(execFile);
const MAX_TITLE_BYTES = 512;

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

export interface AionUiCodingJourneyServiceConfig {
  readonly persistence: ActestraPersistencePort;
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

export class AionUiCodingJourneyServiceError extends Error {
  constructor(
    readonly code:
      | "agent-unavailable"
      | "workspace-unavailable"
      | "task-not-owned"
      | "task-conflict"
      | "approval-not-pending"
      | "execution-failed",
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
    const result = await execFileAsync(
      "/usr/bin/git",
      ["-C", rootPath, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        env: {
          PATH: "/usr/bin:/bin",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        maxBuffer: 64 * 1024,
      },
    );
    const reportedRoot = result.stdout.trim();
    if (reportedRoot !== rootPath) {
      throw new Error("AionUI coding workspace must be the canonical Git worktree root");
    }
    return rootPath;
  } catch (error) {
    throw new AionUiCodingJourneyServiceError(
      "workspace-unavailable",
      "AionUI coding requires one canonical native Git workspace",
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
  private readonly journeyFailures = new Map<string, unknown>();

  constructor(private readonly config: AionUiCodingJourneyServiceConfig) {}

  submit(value: unknown): Promise<AionUiCodingJourneyProjection> {
    assertAionUiCodingJourneySubmitRequest(value);
    const intent = Object.freeze({ ...value }) as AionUiCodingJourneySubmitRequest;
    const identities = deriveAionUiCodingJourneyIdentities(
      intent.nativeConversationId,
      intent.submissionId,
    );
    const existing = this.submissions.get(identities.taskId);
    if (existing !== undefined) return existing;
    const operation = this.submitOnce(intent, identities).finally(() => {
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
    await active.session.close();
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
    return decision.finally(() => {
      request.signal.removeEventListener("abort", onAbort);
      if (this.pendingToolApprovals.get(taskIdValue) === pending) {
        this.pendingToolApprovals.delete(taskIdValue);
      }
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
    return decision.finally(() => {
      request.signal.removeEventListener("abort", onAbort);
      if (this.pendingPublishApprovals.get(taskIdValue) === pending) {
        this.pendingPublishApprovals.delete(taskIdValue);
      }
    });
  }

  async waitForIdle(taskIdValue?: string): Promise<void> {
    if (taskIdValue !== undefined) {
      const stableTaskId = taskId(taskIdValue);
      await this.activeJourneys.get(stableTaskId)?.completion;
      const failure = this.journeyFailures.get(stableTaskId);
      this.journeyFailures.delete(stableTaskId);
      if (failure !== undefined) throw failure;
      return;
    }
    const active = [...this.activeJourneys.values()].map(({ completion }) => completion);
    await Promise.all(active);
    const failure = this.journeyFailures.values().next().value as unknown;
    this.journeyFailures.clear();
    if (failure !== undefined) throw failure;
  }

  async close(): Promise<void> {
    const active = [...this.activeJourneys.values()];
    await Promise.allSettled(active.map(({ session }) => session.close()));
    await Promise.allSettled(active.map(({ completion }) => completion));
  }

  private async submitOnce(
    intent: AionUiCodingJourneySubmitRequest,
    identities: CodingJourneyIdentities,
  ): Promise<AionUiCodingJourneyProjection> {
    const nativeContext = await canonicalizeAionUiGeneralWorkNativeContext(
      await this.config.nativeContext.resolve(intent.nativeConversationId),
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
        approvalDecisionHandler: (request) =>
          this.awaitToolApprovalDecision(identities.taskId, request),
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
      .prompt({ text: intent.prompt })
      .then(async (result) => {
        active.promptResult = result;
        if (result.stopReason === "cancelled") {
          await session.close();
          return;
        }
        const publishResult = await session.publish({
          decisionHandler: (request) => this.awaitPublishDecision(identities.taskId, request),
        });
        if (publishResult.status === "published") {
          await session.close();
        } else {
          active.retainAfterCompletion = true;
        }
      })
      .catch(async (error: unknown): Promise<void> => {
        if (!this.journeyFailures.has(identities.taskId)) {
          this.journeyFailures.set(identities.taskId, error);
        }
        await session.close().catch((): undefined => undefined);
      })
      .finally(() => {
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
            title: "Publish Actestra coding patch",
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
            title: "Publish Actestra coding patch",
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
        artifacts.map((artifact) =>
          Object.freeze({
            artifactId: artifact.id,
            label: artifact.label,
            state: artifact.state,
          }),
        ),
      ),
    }) satisfies AionUiCodingJourneyProjection;
    assertAionUiCodingJourneyProjection(projection);
    return projection;
  }
}
