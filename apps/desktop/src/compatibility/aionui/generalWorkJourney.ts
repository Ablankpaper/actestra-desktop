import {
  assertDomainGraph,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  artifactId,
  compareInstants,
  instant,
  parseWritingArtifactBrief,
  taskId,
  type Session,
  type Task,
  type TaskId,
  type TaskState,
  type Worker,
  type Workspace,
  type ArtifactId,
  type ArtifactKind,
  type ArtifactState,
  type StoreContentReferenceInput,
  type WorkspaceGrant,
} from "../../core";

export const AIONUI_GENERAL_WORK_CONTRACT_VERSION = 1 as const;
export const AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES = 16 * 1024;
export const AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION = 100;
export const AIONUI_GENERAL_WORK_JOURNEY_KINDS = [
  "prompt-artifact",
  "workspace-file-artifact",
  "local-research-artifact",
  "writing-artifact",
] as const;

const MAX_NATIVE_CONVERSATION_ID_LENGTH = 256;
const MAX_SUBMISSION_ID_LENGTH = 128;
const AIONUI_GENERAL_WORK_COMMAND_RE = /^\/actestra(?:\s+([\s\S]*))?$/iu;
const AIONUI_GENERAL_WORK_FILE_COMMAND_RE = /^file(?:\s+([\s\S]*))?$/iu;
const AIONUI_GENERAL_WORK_RESEARCH_COMMAND_RE = /^research(?:\s+([\s\S]*))?$/iu;
const AIONUI_GENERAL_WORK_WRITE_COMMAND_RE = /^write(?:\s+([\s\S]*))?$/iu;
const AIONUI_GENERAL_WORK_COMMAND_PADDING_RE = /^(?:[^\S\u2028\u2029])+|(?:[^\S\u2028\u2029])+$/gu;
const INTENT_KEYS = [
  "contractVersion",
  "nativeConversationId",
  "submissionId",
  "prompt",
  "journeyKind",
] as const;
const REGISTRATION_COMMON_KEYS = [
  "link",
  "workspace",
  "task",
  "session",
  "worker",
  "workspaceGrant",
  "promptReference",
] as const;
const LINK_KEYS = [
  "contractVersion",
  "conversationHash",
  "taskId",
  "journeyKind",
  "createdAt",
] as const;
const PROJECTION_KEYS = [
  "contractVersion",
  "taskId",
  "status",
  "title",
  "summary",
  "incidentCode",
  "canCancel",
  "createdAt",
  "updatedAt",
  "artifacts",
] as const;
const ARTIFACT_PROJECTION_KEYS = ["artifactId", "kind", "label", "state"] as const;
const TASK_STATES: readonly TaskState[] = [
  "draft",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];
const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "file",
  "document",
  "dataset",
  "directory",
  "other",
];
const ARTIFACT_STATES: readonly ArtifactState[] = ["available", "superseded"];
const CANCELLABLE_TASK_STATES: readonly TaskState[] = ["running", "blocked"];

export type AionUiGeneralWorkJourneyKind = (typeof AIONUI_GENERAL_WORK_JOURNEY_KINDS)[number];

export interface AionUiGeneralWorkCommand {
  readonly prompt: string;
  readonly journeyKind: AionUiGeneralWorkJourneyKind;
}

export interface AionUiGeneralWorkIntent {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly submissionId: string;
  readonly prompt: string;
  readonly journeyKind?: AionUiGeneralWorkJourneyKind;
}

function trimAionUiGeneralWorkCommandPadding(value: string): string {
  return value.replace(AIONUI_GENERAL_WORK_COMMAND_PADDING_RE, "");
}

export function parseAionUiGeneralWorkCommand(value: string): AionUiGeneralWorkCommand | null {
  const command = trimAionUiGeneralWorkCommandPadding(value).match(AIONUI_GENERAL_WORK_COMMAND_RE);
  if (command === null) {
    return null;
  }
  const body = trimAionUiGeneralWorkCommandPadding(command[1] ?? "");
  const fileCommand = body.match(AIONUI_GENERAL_WORK_FILE_COMMAND_RE);
  if (fileCommand !== null) {
    return Object.freeze({
      prompt: trimAionUiGeneralWorkCommandPadding(fileCommand[1] ?? ""),
      journeyKind: "workspace-file-artifact",
    });
  }
  const researchCommand = body.match(AIONUI_GENERAL_WORK_RESEARCH_COMMAND_RE);
  if (researchCommand !== null) {
    return Object.freeze({
      prompt: trimAionUiGeneralWorkCommandPadding(researchCommand[1] ?? ""),
      journeyKind: "local-research-artifact",
    });
  }
  const writeCommand = body.match(AIONUI_GENERAL_WORK_WRITE_COMMAND_RE);
  if (writeCommand !== null) {
    return Object.freeze({
      prompt: trimAionUiGeneralWorkCommandPadding(writeCommand[1] ?? ""),
      journeyKind: "writing-artifact",
    });
  }
  return Object.freeze({
    prompt: body,
    journeyKind: "prompt-artifact",
  });
}

export interface AionUiGeneralWorkLink {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly conversationHash: string;
  readonly taskId: TaskId;
  readonly journeyKind: AionUiGeneralWorkJourneyKind;
  readonly createdAt: ReturnType<typeof instant>;
}

interface AionUiGeneralWorkRegistrationBase {
  readonly link: AionUiGeneralWorkLink;
  readonly workspace: Workspace;
  readonly task: Task;
  readonly session: Session;
  readonly worker: Worker;
  readonly workspaceGrant: WorkspaceGrant;
  readonly promptReference: StoreContentReferenceInput;
}

export interface AionUiPromptArtifactRegistration extends AionUiGeneralWorkRegistrationBase {
  readonly link: AionUiGeneralWorkLink & {
    readonly journeyKind: "prompt-artifact";
  };
  readonly toolInputReference: StoreContentReferenceInput;
}

export interface AionUiWorkspaceFileArtifactRegistration extends AionUiGeneralWorkRegistrationBase {
  readonly link: AionUiGeneralWorkLink & {
    readonly journeyKind: "workspace-file-artifact";
  };
  readonly readInputReference: StoreContentReferenceInput;
}

export interface AionUiLocalResearchArtifactRegistration extends AionUiGeneralWorkRegistrationBase {
  readonly link: AionUiGeneralWorkLink & {
    readonly journeyKind: "local-research-artifact";
  };
  readonly readInputReference: StoreContentReferenceInput;
}

export interface AionUiWritingArtifactRegistration extends AionUiGeneralWorkRegistrationBase {
  readonly link: AionUiGeneralWorkLink & {
    readonly journeyKind: "writing-artifact";
  };
}

export type AionUiGeneralWorkRegistration =
  | AionUiPromptArtifactRegistration
  | AionUiWorkspaceFileArtifactRegistration
  | AionUiLocalResearchArtifactRegistration
  | AionUiWritingArtifactRegistration;

export interface AionUiGeneralWorkArtifactProjection {
  readonly artifactId: ArtifactId;
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly state: ArtifactState;
}

export interface AionUiGeneralWorkProjection {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly taskId: TaskId;
  readonly status: TaskState;
  readonly title: string;
  readonly summary?: string;
  readonly incidentCode?: string;
  readonly canCancel: boolean;
  readonly createdAt: ReturnType<typeof instant>;
  readonly updatedAt: ReturnType<typeof instant>;
  readonly artifacts: readonly AionUiGeneralWorkArtifactProjection[];
}

export interface RegisterAionUiGeneralWorkJourneyResult {
  readonly status: "stored" | "duplicate";
  readonly link: AionUiGeneralWorkLink;
}

export interface AionUiGeneralWorkJourneyPersistencePort {
  registerAionUiGeneralWorkJourney(
    registration: AionUiGeneralWorkRegistration,
  ): Promise<RegisterAionUiGeneralWorkJourneyResult>;
  listAionUiGeneralWorkJourneyLinks(
    conversationHash: string,
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]>;
  listPreparedAionUiGeneralWorkJourneyLinks(
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]>;
}

export class AionUiGeneralWorkJourneyError extends Error {
  constructor(
    readonly code: "invalid-intent" | "invalid-registration" | "invalid-projection",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiGeneralWorkJourneyError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  code: AionUiGeneralWorkJourneyError["code"],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new AionUiGeneralWorkJourneyError(
      code,
      `${label} contains unsupported field ${unexpected}`,
    );
  }
}

function containsForbiddenControl(value: string, allowLayoutControls: boolean): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }
    if (allowLayoutControls && (codePoint === 9 || codePoint === 10 || codePoint === 13)) {
      return false;
    }
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function boundedIdentifier(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    containsForbiddenControl(value, false)
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-intent",
      `${label} must be a bounded opaque identifier`,
    );
  }
}

export function assertAionUiNativeConversationId(value: unknown): asserts value is string {
  boundedIdentifier(value, "AionUI conversation identity", MAX_NATIVE_CONVERSATION_ID_LENGTH);
}

function boundedPrompt(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES ||
    containsForbiddenControl(value, true)
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-intent",
      "AionUI general-work prompt must be bounded UTF-8 text",
    );
  }
}

export function assertAionUiGeneralWorkIntent(
  value: unknown,
): asserts value is AionUiGeneralWorkIntent {
  if (!isRecord(value) || value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-intent",
      "AionUI general-work intent must use contract version 1",
    );
  }
  assertExactKeys(value, INTENT_KEYS, "AionUI general-work intent", "invalid-intent");
  assertAionUiNativeConversationId(value.nativeConversationId);
  boundedIdentifier(value.submissionId, "AionUI submission identity", MAX_SUBMISSION_ID_LENGTH);
  boundedPrompt(value.prompt);
  if (value.journeyKind === "writing-artifact") {
    try {
      parseWritingArtifactBrief(value.prompt);
    } catch (error) {
      throw new AionUiGeneralWorkJourneyError(
        "invalid-intent",
        "AionUI writing brief violates the closed writing contract",
        { cause: error },
      );
    }
  }
  if (
    value.journeyKind !== undefined &&
    !AIONUI_GENERAL_WORK_JOURNEY_KINDS.includes(value.journeyKind as AionUiGeneralWorkJourneyKind)
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-intent",
      "AionUI general-work journey kind is invalid",
    );
  }
}

export function assertAionUiGeneralWorkRegistration(
  value: unknown,
): asserts value is AionUiGeneralWorkRegistration {
  if (!isRecord(value) || !isRecord(value.link)) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work registration must be an object",
    );
  }
  const link = value.link;
  assertExactKeys(link, LINK_KEYS, "AionUI general-work link", "invalid-registration");
  if (
    link.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof link.conversationHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(link.conversationHash) ||
    typeof link.taskId !== "string" ||
    typeof link.journeyKind !== "string" ||
    !AIONUI_GENERAL_WORK_JOURNEY_KINDS.includes(link.journeyKind as AionUiGeneralWorkJourneyKind) ||
    typeof link.createdAt !== "string"
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work link is invalid",
    );
  }
  const initialInputField =
    link.journeyKind === "writing-artifact"
      ? undefined
      : link.journeyKind === "prompt-artifact"
        ? "toolInputReference"
        : "readInputReference";
  assertExactKeys(
    value,
    initialInputField === undefined
      ? REGISTRATION_COMMON_KEYS
      : [...REGISTRATION_COMMON_KEYS, initialInputField],
    "AionUI general-work registration",
    "invalid-registration",
  );
  const initialInputReference =
    initialInputField === undefined ? undefined : value[initialInputField];
  try {
    taskId(link.taskId);
    instant(link.createdAt);
    assertWorkspaceGrant(value.workspaceGrant);
    assertStoreContentReferenceInput(value.promptReference);
    if (link.journeyKind === "writing-artifact") {
      parseWritingArtifactBrief((value.promptReference as StoreContentReferenceInput).content);
    }
    if (initialInputField !== undefined) {
      assertStoreContentReferenceInput(initialInputReference);
    }
    assertDomainGraph({
      workspaces: [value.workspace as Workspace],
      tasks: [value.task as Task],
      sessions: [value.session as Session],
      workers: [value.worker as Worker],
      approvals: [],
      artifacts: [],
    });
  } catch (error) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work registration violates the domain contract",
      { cause: error },
    );
  }
  if ((value.task as Task).id !== link.taskId) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work link must own the registered task",
    );
  }
  const workspace = value.workspace as Workspace;
  const task = value.task as Task;
  const session = value.session as Session;
  const worker = value.worker as Worker;
  const grant = value.workspaceGrant as WorkspaceGrant;
  const promptReference = value.promptReference as StoreContentReferenceInput;
  if (
    workspace.state !== "active" ||
    task.state !== "ready" ||
    task.activeSessionId !== session.id ||
    session.state !== "created" ||
    worker.state !== "created"
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work registration must begin in the ready/created state",
    );
  }
  if (
    grant.workspaceId !== workspace.id ||
    grant.state !== "active" ||
    promptReference.kind !== "tool-input" ||
    promptReference.classification !== "task-content" ||
    promptReference.mediaType !== "text/plain; charset=utf-8" ||
    promptReference.owner.workspaceId !== workspace.id ||
    promptReference.owner.taskId !== task.id ||
    promptReference.owner.sessionId !== session.id ||
    promptReference.owner.workerId !== worker.id ||
    promptReference.owner.grantId !== grant.grantId ||
    promptReference.owner.requestId !== undefined ||
    promptReference.createdAt !== link.createdAt
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work registration must atomically own its grant and prompt",
    );
  }
  if (initialInputReference !== undefined) {
    const initialReference = initialInputReference as StoreContentReferenceInput;
    if (
      initialReference.reference === promptReference.reference ||
      initialReference.kind !== "tool-input" ||
      initialReference.classification !== "task-content" ||
      initialReference.mediaType !== "text/plain; charset=utf-8" ||
      initialReference.owner.workspaceId !== workspace.id ||
      initialReference.owner.taskId !== task.id ||
      initialReference.owner.sessionId !== session.id ||
      initialReference.owner.workerId !== worker.id ||
      initialReference.owner.grantId !== grant.grantId ||
      initialReference.owner.requestId === undefined ||
      initialReference.createdAt !== link.createdAt
    ) {
      throw new AionUiGeneralWorkJourneyError(
        "invalid-registration",
        "AionUI general-work registration must atomically own its initial input",
      );
    }
  }
}

export function assertAionUiGeneralWorkLink(
  value: unknown,
): asserts value is AionUiGeneralWorkLink {
  if (!isRecord(value)) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work link must be an object",
    );
  }
  assertExactKeys(value, LINK_KEYS, "AionUI general-work link", "invalid-registration");
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof value.conversationHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.conversationHash) ||
    typeof value.taskId !== "string" ||
    typeof value.journeyKind !== "string" ||
    !AIONUI_GENERAL_WORK_JOURNEY_KINDS.includes(
      value.journeyKind as AionUiGeneralWorkJourneyKind,
    ) ||
    typeof value.createdAt !== "string"
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work link is invalid",
    );
  }
  try {
    taskId(value.taskId);
    instant(value.createdAt);
  } catch (error) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-registration",
      "AionUI general-work link identity is invalid",
      { cause: error },
    );
  }
}

function assertProjectionText(
  value: unknown,
  label: string,
  maximumBytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > maximumBytes ||
    containsForbiddenControl(value, true)
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      `${label} must be bounded presentation text`,
    );
  }
}

export function assertAionUiGeneralWorkProjection(
  value: unknown,
): asserts value is AionUiGeneralWorkProjection {
  if (!isRecord(value)) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      "AionUI general-work projection must be an object",
    );
  }
  assertExactKeys(value, PROJECTION_KEYS, "AionUI general-work projection", "invalid-projection");
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof value.taskId !== "string" ||
    typeof value.status !== "string" ||
    !TASK_STATES.includes(value.status as TaskState) ||
    typeof value.canCancel !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 20
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      "AionUI general-work projection shape is invalid",
    );
  }
  let createdAt: ReturnType<typeof instant>;
  let updatedAt: ReturnType<typeof instant>;
  try {
    taskId(value.taskId);
    createdAt = instant(value.createdAt);
    updatedAt = instant(value.updatedAt);
  } catch (error) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      "AionUI general-work projection identity or time is invalid",
      { cause: error },
    );
  }
  if (
    compareInstants(updatedAt, createdAt) < 0 ||
    value.canCancel !== CANCELLABLE_TASK_STATES.includes(value.status as TaskState)
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      "AionUI general-work projection lifecycle metadata is inconsistent",
    );
  }
  assertProjectionText(value.title, "AionUI general-work title", 512);
  if (value.summary !== undefined) {
    assertProjectionText(value.summary, "AionUI general-work summary", 16 * 1024);
  }
  if (
    value.incidentCode !== undefined &&
    (typeof value.incidentCode !== "string" ||
      !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u.test(value.incidentCode))
  ) {
    throw new AionUiGeneralWorkJourneyError(
      "invalid-projection",
      "AionUI general-work incident code is invalid",
    );
  }
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)) {
      throw new AionUiGeneralWorkJourneyError(
        "invalid-projection",
        "AionUI general-work artifact projection must be an object",
      );
    }
    assertExactKeys(
      artifact,
      ARTIFACT_PROJECTION_KEYS,
      "AionUI general-work artifact projection",
      "invalid-projection",
    );
    if (
      typeof artifact.artifactId !== "string" ||
      typeof artifact.kind !== "string" ||
      !ARTIFACT_KINDS.includes(artifact.kind as ArtifactKind) ||
      typeof artifact.state !== "string" ||
      !ARTIFACT_STATES.includes(artifact.state as ArtifactState)
    ) {
      throw new AionUiGeneralWorkJourneyError(
        "invalid-projection",
        "AionUI general-work artifact projection shape is invalid",
      );
    }
    try {
      artifactId(artifact.artifactId);
    } catch (error) {
      throw new AionUiGeneralWorkJourneyError(
        "invalid-projection",
        "AionUI general-work artifact projection identity is invalid",
        { cause: error },
      );
    }
    assertProjectionText(artifact.label, "AionUI general-work artifact label", 512);
  }
}
