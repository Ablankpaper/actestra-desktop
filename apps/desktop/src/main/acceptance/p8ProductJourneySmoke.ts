import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ActestraPersistencePort } from "../../core";
import {
  projectArtifactDelivery,
  type AionUiCodingJourneyProjection,
  type AionUiTeamBridgeRoute,
  type NativeAionUiTeam,
  type NativeAionUiTeamNodeView,
  type NativeAionUiTeamRunAck,
  type NativeAionUiTeamRunState,
} from "../../compatibility/aionui";
import {
  deriveAionUiCodingJourneyIdentities,
  type AionUiCodingJourneyService,
} from "../compatibility/aionuiCodingJourneyService";
import type { AionUiCodingArtifactService } from "../compatibility/aionuiCodingArtifactService";
import type { ArtifactDeliveryRecord, WorkspaceGrant, WorkspaceId } from "../../core";
import type { AionUiGeneralWorkJourneyService } from "../compatibility/aionuiGeneralWorkJourneyService";
import {
  P8_PRODUCT_JOURNEY_FILE,
  P8_PRODUCT_JOURNEY_FILE_CONTENT,
  P8_PRODUCT_JOURNEY_GENERAL_MARKDOWN,
} from "./p8ProductJourneyRuntime";
import {
  parseP8ProductJourneyRestartJournal,
  writeP8ProductJourneyRestartJournal,
  type P8ProductJourneyRestartJournal,
} from "../security/p8ProductJourneySmoke";
import type { AionUiGeneralWorkJourneyService as GeneralWorkJourneyService } from "../compatibility/aionuiGeneralWorkJourneyService";
import type { GeneralWorkRecoveryResult } from "../workers/generalWorkCoordinator";

/**
 * The P8.2 packaged controller and the Main hook intentionally share a closed
 * journey order. Keep this list independent of user-facing labels: it is an
 * evidence identity, not a presentation contract.
 */
export const P8_PRODUCT_JOURNEY_SMOKE_IDS = Object.freeze([
  "fresh-profile-launch",
  "general-artifact",
  "goose-isolated-patch",
  "workspace-apply-approval",
  "general-goose-team",
  "cancellation-no-orphan",
  "crash-restart-recovery",
  "privacy-redaction",
  "p7-platform-obligations",
] as const);

export const P8_PRODUCT_JOURNEY_SMOKE_RESULT_FILE_NAME = "p8-product-journeys-result.json" as const;
const MAX_RESULT_BYTES = 32 * 1024;
const RESULT_KEYS = Object.freeze(["schemaVersion", "status", "journeys"] as const);
const JOURNEY_KEYS = Object.freeze(["id", "status", "residualProcessCount"] as const);

export type P8ProductJourneySmokeId = (typeof P8_PRODUCT_JOURNEY_SMOKE_IDS)[number];
export type P8ProductJourneySmokeJourneyStatus = "verified" | "failed";

export interface P8ProductJourneySmokeJourney {
  readonly id: P8ProductJourneySmokeId;
  readonly status: P8ProductJourneySmokeJourneyStatus;
  readonly residualProcessCount: number;
}

export interface P8ProductJourneySmokeResult {
  readonly schemaVersion: 1;
  readonly status: P8ProductJourneySmokeJourneyStatus;
  readonly journeys: readonly P8ProductJourneySmokeJourney[];
}

export interface P8ProductJourneySmokeConfig {
  readonly enabled: true;
}

export interface P8ProductJourneyTeamAuthority {
  dispatch(route: AionUiTeamBridgeRoute): Promise<unknown>;
}

export interface P8GeneralGooseTeamJourneyInput {
  readonly authority: P8ProductJourneyTeamAuthority;
  readonly persistence: Pick<
    ActestraPersistencePort,
    "getTeamDefinition" | "listTeamRunsForTeam" | "getTeamRunSnapshot" | "loadDomainGraph"
  >;
  readonly workspaceId: WorkspaceId;
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Main owns the journey calls. The methods deliberately describe product
 * authorities rather than accepting arbitrary test callbacks or shell commands.
 * Each implementation is assembled from the already-admitted General, Goose,
 * Artifact, Team, and P7 services by the downstream Main bridge.
 */
export interface P8ProductJourneySmokeAuthority {
  readonly runFreshProfileLaunch: () => Promise<void>;
  readonly runGeneralArtifact: () => Promise<void>;
  readonly runGooseIsolatedPatch: () => Promise<void>;
  readonly runWorkspaceApplyApproval: () => Promise<void>;
  readonly runGeneralGooseTeam: () => Promise<void>;
  readonly runCancellationNoOrphan: () => Promise<void>;
  readonly runCrashRestartRecovery: () => Promise<void>;
  readonly runPrivacyRedaction: () => Promise<void>;
  readonly runP7PlatformObligations: () => Promise<void>;
  /** A failed/unknown probe is conservative and cannot become zero. */
  readonly residualProcessCount: () => Promise<number>;
}

type P8GeneralArtifactJourneyService = Pick<
  AionUiGeneralWorkJourneyService,
  "submitFromTrustedContext" | "waitForIdle" | "list" | "preview"
>;

export interface P8GeneralArtifactJourneyInput {
  readonly service: P8GeneralArtifactJourneyService;
  readonly persistence: Pick<
    ActestraPersistencePort,
    "loadDomainGraph" | "getGeneralWorkCheckpoint"
  >;
  readonly workspaceRoot: string;
}

const P8_GENERAL_ARTIFACT_CONVERSATION_ID =
  "conversation-p8-product-journeys-general-artifact" as const;
const P8_GENERAL_ARTIFACT_SUBMISSION_ID =
  "submission-p8-product-journeys-general-artifact" as const;
const P8_GENERAL_ARTIFACT_PROMPT = [
  "Title: P8.2 deterministic journey proof",
  "Audience: Actestra release acceptance",
  "Purpose: Prove the packaged Main-owned General Artifact journey.",
  "Point: Persist one bounded writing Artifact.",
  "Point: Preserve terminal Worker and checkpoint evidence.",
].join("\n");

function requireP8GeneralArtifactWorkspace(workspaceRoot: string): string {
  if (
    typeof workspaceRoot !== "string" ||
    !path.isAbsolute(workspaceRoot) ||
    workspaceRoot.trim() !== workspaceRoot ||
    workspaceRoot === path.parse(workspaceRoot).root
  ) {
    throw new Error("P8.2 General Artifact workspace is invalid");
  }
  const existing = fs.lstatSync(workspaceRoot, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() || (existing !== undefined && !existing.isDirectory())) {
    throw new Error("P8.2 General Artifact workspace is invalid");
  }
  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  const canonical = fs.realpathSync(workspaceRoot);
  if (!path.isAbsolute(canonical) || canonical === path.parse(canonical).root) {
    throw new Error("P8.2 General Artifact workspace is invalid");
  }
  return canonical;
}

/**
 * Exercise the existing General Work vertical slice and accept only its real
 * durable Main/Core result. This is product acceptance composition: it does
 * not create a second Worker, persistence, Artifact, or preview authority.
 */
export async function runP8GeneralArtifactJourney(
  input: P8GeneralArtifactJourneyInput,
): Promise<void> {
  const workspaceRoot = requireP8GeneralArtifactWorkspace(input.workspaceRoot);
  const submitted = await input.service.submitFromTrustedContext(
    Object.freeze({
      contractVersion: 1 as const,
      nativeConversationId: P8_GENERAL_ARTIFACT_CONVERSATION_ID,
      submissionId: P8_GENERAL_ARTIFACT_SUBMISSION_ID,
      journeyKind: "writing-artifact" as const,
      prompt: P8_GENERAL_ARTIFACT_PROMPT,
    }),
    Object.freeze({
      rootPath: workspaceRoot,
      displayName: "Actestra P8.2 General Artifact workspace",
    }),
  );
  await input.service.waitForIdle();

  const projections = await input.service.list(P8_GENERAL_ARTIFACT_CONVERSATION_ID);
  const projection = projections.find((candidate) => candidate.taskId === submitted.taskId);
  if (
    projection === undefined ||
    projections.length !== 1 ||
    projection.status !== "completed" ||
    projection.canCancel ||
    projection.artifacts.length !== 1
  ) {
    throw new Error("P8.2 General Artifact projection is incomplete");
  }
  const projectedArtifact = projection.artifacts[0]!;
  if (
    projectedArtifact.kind !== "document" ||
    projectedArtifact.label !== "Actestra writing draft" ||
    projectedArtifact.state !== "available"
  ) {
    throw new Error("P8.2 General Artifact projection is incomplete");
  }

  const preview = await input.service.preview(
    P8_GENERAL_ARTIFACT_CONVERSATION_ID,
    projection.taskId,
    projectedArtifact.artifactId,
  );
  if (
    preview.taskId !== projection.taskId ||
    preview.artifactId !== projectedArtifact.artifactId ||
    preview.label !== projectedArtifact.label ||
    preview.mediaType !== "text/markdown; charset=utf-8" ||
    !("content" in preview) ||
    preview.content !== P8_PRODUCT_JOURNEY_GENERAL_MARKDOWN
  ) {
    throw new Error("P8.2 General Artifact preview is incomplete");
  }

  const graph = await input.persistence.loadDomainGraph();
  const task = graph.tasks.find((candidate) => candidate.id === projection.taskId);
  const sessions = graph.sessions.filter((candidate) => candidate.taskId === projection.taskId);
  const artifacts = graph.artifacts.filter((candidate) => candidate.taskId === projection.taskId);
  const session = sessions[0];
  const worker =
    session === undefined
      ? undefined
      : graph.workers.find((candidate) => candidate.id === session.workerId);
  const artifact = artifacts[0];
  if (
    task?.state !== "completed" ||
    sessions.length !== 1 ||
    session?.state !== "completed" ||
    worker?.state !== "stopped" ||
    artifacts.length !== 1 ||
    artifact?.id !== projectedArtifact.artifactId ||
    artifact.kind !== "document" ||
    artifact.state !== "available"
  ) {
    throw new Error("P8.2 General Artifact durable state is incomplete");
  }
  const checkpoint = await input.persistence.getGeneralWorkCheckpoint(session.id);
  if (
    checkpoint?.phase !== "finalized" ||
    checkpoint.attempt.state !== "completed" ||
    checkpoint.attempt.taskState !== "completed" ||
    checkpoint.attempt.disposed !== true ||
    checkpoint.artifactBinding === undefined ||
    !isDeepStrictEqual(checkpoint.artifactBinding.artifact, artifact)
  ) {
    throw new Error("P8.2 General Artifact checkpoint is incomplete");
  }
  const boundedEvidence = JSON.stringify(checkpoint.events);
  if (
    boundedEvidence.includes(P8_GENERAL_ARTIFACT_PROMPT) ||
    boundedEvidence.includes(workspaceRoot) ||
    boundedEvidence.includes(P8_PRODUCT_JOURNEY_GENERAL_MARKDOWN)
  ) {
    throw new Error("P8.2 General Artifact evidence contains private content");
  }
}

type P8GooseIsolatedPatchJourneyService = Pick<
  AionUiCodingJourneyService,
  | "submitFromTrustedContext"
  | "list"
  | "waitForIdle"
  | "decideApproval"
  | "decidePublish"
  | "getArtifactPatchPreview"
>;

export interface P8GooseIsolatedPatchJourneyInput {
  readonly service: P8GooseIsolatedPatchJourneyService;
  readonly persistence: Pick<
    ActestraPersistencePort,
    "loadDomainGraph" | "getActiveWorkspaceGrant"
  >;
  /** The canonical native Git workspace; it is never modified by this journey. */
  readonly workspaceRoot: string;
  /** Main's isolated-coding managed root, used only for the cleanup postcondition. */
  readonly managedRoot: string;
  /** Original workspace identity that the later Apply journey is allowed to target. */
  readonly destinationWorkspaceId?: WorkspaceId;
}

const P8_GOOSE_PATCH_CONVERSATION_ID = "conversation-p8-product-journeys-goose-patch" as const;
const P8_GOOSE_PATCH_SUBMISSION_ID = "submission-p8-product-journeys-goose-patch" as const;
const P8_GOOSE_PATCH_PROMPT = [
  "Create a small isolated coding patch for the Actestra P8.2 acceptance journey.",
  "Write p8-journey-proof.txt with the supplied deterministic proof text.",
  "Inspect the isolated Git state and diff, then leave the patch ready for review.",
].join(" ");
const P8_CODING_PROJECTION_TIMEOUT_MS = 5 * 60 * 1_000;
const P8_CODING_APPROVAL_LIMIT = 8;

function requireCanonicalDirectory(directory: string, message: string): string {
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    path.resolve(directory) !== directory ||
    path.parse(directory).root === directory
  ) {
    throw new Error(message);
  }
  const metadata = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (metadata?.isSymbolicLink() || (metadata !== undefined && !metadata.isDirectory())) {
    throw new Error(message);
  }
  if (metadata === undefined) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const canonical = fs.realpathSync(directory);
  if (
    !path.isAbsolute(canonical) ||
    canonical === path.parse(canonical).root ||
    canonical !== directory
  ) {
    throw new Error(message);
  }
  return canonical;
}

function codingProjectionIsTerminal(projection: AionUiCodingJourneyProjection): boolean {
  return (
    projection.status === "completed" ||
    projection.status === "failed" ||
    projection.status === "cancelled"
  );
}

async function waitForCodingProjection(
  service: Pick<P8GooseIsolatedPatchJourneyService, "list">,
  conversationId: string,
  predicate: (projection: AionUiCodingJourneyProjection) => boolean,
  timeoutMs = P8_CODING_PROJECTION_TIMEOUT_MS,
): Promise<AionUiCodingJourneyProjection> {
  const deadline = Date.now() + timeoutMs;
  let latest: AionUiCodingJourneyProjection | undefined;
  while (Date.now() < deadline) {
    const projections = await service.list(conversationId, 1);
    latest = projections[0];
    if (latest !== undefined && predicate(latest)) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    latest === undefined
      ? "P8.2 Goose isolated Patch projection did not appear"
      : "P8.2 Goose isolated Patch projection timed out",
  );
}

/**
 * Run the real Main-owned Goose coding journey to a reviewed Patch Artifact.
 * Tool and publish approvals are driven through the existing service APIs so
 * the isolated worktree, policy engine, persistence, and Artifact publisher
 * remain the only authorities. The original workspace is deliberately never
 * used as an execution root.
 */
export async function runP8GooseIsolatedPatchJourney(
  input: P8GooseIsolatedPatchJourneyInput,
): Promise<void> {
  const workspaceRoot = requireCanonicalDirectory(
    input.workspaceRoot,
    "P8.2 Goose isolated Patch workspace is invalid",
  );
  const managedRoot = requireCanonicalDirectory(
    input.managedRoot,
    "P8.2 Goose isolated Patch managed root is invalid",
  );
  // The app may already have unrelated coding WIP in this shared managed root.
  // Snapshot only its direct entries and require the journey to leave that
  // existing set intact; do not turn a product smoke into a blanket cleanup.
  const managedEntriesBefore = new Map(
    fs
      .readdirSync(managedRoot, { withFileTypes: true })
      .map((entry) => [
        entry.name,
        entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      ]),
  );
  const sourceProofPath = path.join(workspaceRoot, P8_PRODUCT_JOURNEY_FILE);
  if (fs.existsSync(sourceProofPath)) {
    throw new Error("P8.2 Goose isolated Patch source workspace is not pristine");
  }

  const submitted = await input.service.submitFromTrustedContext(
    Object.freeze({
      contractVersion: 1 as const,
      nativeConversationId: P8_GOOSE_PATCH_CONVERSATION_ID,
      submissionId: P8_GOOSE_PATCH_SUBMISSION_ID,
      prompt: P8_GOOSE_PATCH_PROMPT,
    }),
    Object.freeze({
      rootPath: workspaceRoot,
      displayName: "Actestra P8.2 Goose isolated Patch workspace",
    }),
    input.destinationWorkspaceId,
  );

  let current = await waitForCodingProjection(
    input.service,
    P8_GOOSE_PATCH_CONVERSATION_ID,
    (candidate) =>
      candidate.taskId === submitted.taskId &&
      (candidate.approval !== undefined || codingProjectionIsTerminal(candidate)),
  );
  let toolApprovalCount = 0;
  while (current.stage === "approval-required") {
    const approval = current.approval;
    if (
      approval === undefined ||
      approval.kind !== "tool" ||
      toolApprovalCount >= P8_CODING_APPROVAL_LIMIT
    ) {
      throw new Error("P8.2 Goose isolated Patch exposed an invalid tool approval");
    }
    await input.service.decideApproval(
      P8_GOOSE_PATCH_CONVERSATION_ID,
      submitted.taskId,
      approval.approvalId,
      "approved",
    );
    toolApprovalCount += 1;
    const resolvedApprovalId = approval.approvalId;
    current = await waitForCodingProjection(
      input.service,
      P8_GOOSE_PATCH_CONVERSATION_ID,
      (candidate) =>
        candidate.taskId === submitted.taskId &&
        (candidate.approval?.approvalId !== resolvedApprovalId ||
          candidate.stage !== "approval-required"),
    );
  }

  if (
    toolApprovalCount < 1 ||
    current.stage !== "publish-approval-required" ||
    current.approval?.kind !== "publish"
  ) {
    throw new Error("P8.2 Goose isolated Patch did not reach its publish approval");
  }
  const publishApprovalId = current.approval.approvalId;
  await input.service.decidePublish(
    P8_GOOSE_PATCH_CONVERSATION_ID,
    submitted.taskId,
    publishApprovalId,
    "approved",
  );
  await input.service.waitForIdle(submitted.taskId);
  current = await waitForCodingProjection(
    input.service,
    P8_GOOSE_PATCH_CONVERSATION_ID,
    (candidate) => candidate.taskId === submitted.taskId && codingProjectionIsTerminal(candidate),
  );

  const artifact = current.artifacts.find(
    (candidate) => candidate.label === "Actestra coding patch" && candidate.state === "available",
  );
  if (
    current.status !== "completed" ||
    current.stage !== "published" ||
    current.canCancel ||
    current.artifacts.length !== 1 ||
    artifact === undefined ||
    !current.tools.some(
      (tool) => tool.kind === "edit" && tool.status === "completed" && tool.surface === "diff",
    )
  ) {
    throw new Error("P8.2 Goose isolated Patch projection is incomplete");
  }
  const patchPreview = await input.service.getArtifactPatchPreview(artifact.artifactId);
  if (
    typeof patchPreview !== "string" ||
    !patchPreview.includes(`p8-journey-proof.txt`) ||
    !patchPreview.includes(`+${P8_PRODUCT_JOURNEY_FILE_CONTENT.trim()}`)
  ) {
    throw new Error("P8.2 Goose isolated Patch Artifact preview is incomplete");
  }

  const graph = await input.persistence.loadDomainGraph();
  const task = graph.tasks.find((candidate) => candidate.id === submitted.taskId);
  const sessions = graph.sessions.filter((candidate) => candidate.taskId === submitted.taskId);
  const artifacts = graph.artifacts.filter((candidate) => candidate.taskId === submitted.taskId);
  const session = sessions[0];
  const worker =
    session === undefined
      ? undefined
      : graph.workers.find((candidate) => candidate.id === session.workerId);
  if (
    task?.state !== "completed" ||
    sessions.length !== 1 ||
    session?.state !== "completed" ||
    worker?.state !== "stopped" ||
    artifacts.length !== 1 ||
    artifacts[0]?.state !== "available"
  ) {
    throw new Error("P8.2 Goose isolated Patch durable state is incomplete");
  }
  const expectedIdentities = deriveAionUiCodingJourneyIdentities(
    P8_GOOSE_PATCH_CONVERSATION_ID,
    P8_GOOSE_PATCH_SUBMISSION_ID,
  );
  if (submitted.taskId !== expectedIdentities.taskId) {
    throw new Error("P8.2 Goose isolated Patch task identity is invalid");
  }
  if ((await input.persistence.getActiveWorkspaceGrant(expectedIdentities.workspaceId)) !== null) {
    throw new Error("P8.2 Goose isolated Patch retained an active isolated grant");
  }
  const managedEntriesAfter = new Map(
    fs
      .readdirSync(managedRoot, { withFileTypes: true })
      .map((entry) => [
        entry.name,
        entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      ]),
  );
  const managedRootWasChanged =
    managedEntriesBefore.size !== managedEntriesAfter.size ||
    [...managedEntriesBefore].some(([name, kind]) => managedEntriesAfter.get(name) !== kind) ||
    [...managedEntriesAfter].some(([name]) => !managedEntriesBefore.has(name));
  if (managedRootWasChanged || fs.existsSync(sourceProofPath)) {
    throw new Error("P8.2 Goose isolated Patch cleanup or source isolation is incomplete");
  }
}

type P8CancellationJourneyService = Pick<
  AionUiCodingJourneyService,
  "submitFromTrustedContext" | "list" | "cancel" | "waitForIdle"
>;

export interface P8CancellationNoOrphanJourneyInput {
  readonly service: P8CancellationJourneyService;
  readonly persistence: Pick<ActestraPersistencePort, "loadDomainGraph">;
  readonly workspaceRoot: string;
  readonly managedRoot: string;
}

const P8_CANCELLATION_CONVERSATION_ID = "conversation-p8-product-journeys-cancellation" as const;
const P8_CANCELLATION_SUBMISSION_ID = "submission-p8-product-journeys-cancellation" as const;
const P8_CANCELLATION_PROMPT =
  "Start one bounded Goose coding attempt for the cancellation/no-orphan acceptance journey and wait for cancellation." as const;
const P8_CANCELLATION_TIMEOUT_MS = 30_000;

const P8_CRASH_RESTART_CONVERSATION_ID = "conversation-p8-product-journeys-crash-restart" as const;
const P8_CRASH_RESTART_SUBMISSION_ID = "submission-p8-product-journeys-crash-restart" as const;
const P8_CRASH_RESTART_PROMPT =
  "Hold one bounded General Work attempt so the packaged app can prove crash/restart recovery." as const;

type P8CrashRestartJourneyService = Pick<
  GeneralWorkJourneyService,
  "submitFromTrustedContext" | "list"
>;

export interface P8CrashRestartRecoveryPrepareJourneyInput {
  readonly service: P8CrashRestartJourneyService;
  readonly persistence: Pick<
    ActestraPersistencePort,
    "loadDomainGraph" | "getGeneralWorkCheckpoint"
  >;
  readonly workspaceRoot: string;
  readonly restartJournalPath: string;
}

export interface P8CrashRestartRecoveryPrepareJourneyResult {
  readonly taskId: string;
  readonly sessionId: string;
}

export async function runP8CrashRestartRecoveryPrepareJourney(
  input: P8CrashRestartRecoveryPrepareJourneyInput,
): Promise<P8CrashRestartRecoveryPrepareJourneyResult> {
  const workspaceRoot = requireCanonicalDirectory(
    input.workspaceRoot,
    "P8.2 crash/restart workspace is invalid",
  );
  const existingJournal = fs.lstatSync(input.restartJournalPath, { throwIfNoEntry: false });
  if (
    existingJournal !== undefined ||
    path.basename(input.restartJournalPath) !== "p8-product-journeys-restart.json"
  ) {
    throw new Error("P8.2 crash/restart journal is not fresh");
  }
  const submitted = await input.service.submitFromTrustedContext(
    Object.freeze({
      contractVersion: 1 as const,
      nativeConversationId: P8_CRASH_RESTART_CONVERSATION_ID,
      submissionId: P8_CRASH_RESTART_SUBMISSION_ID,
      prompt: P8_CRASH_RESTART_PROMPT,
    }),
    Object.freeze({
      rootPath: workspaceRoot,
      displayName: "Actestra P8.2 crash/restart workspace",
    }),
  );
  if (submitted.status !== "running" || submitted.canCancel !== true) {
    throw new Error("P8.2 crash/restart attempt did not remain active");
  }
  const graph = await input.persistence.loadDomainGraph();
  const task = graph.tasks.find((candidate) => candidate.id === submitted.taskId);
  const session =
    task === undefined
      ? undefined
      : graph.sessions.find((candidate) => candidate.taskId === task.id);
  if (task?.state !== "running" || session?.state !== "running") {
    throw new Error("P8.2 crash/restart durable attempt is not active");
  }
  const checkpoint = await input.persistence.getGeneralWorkCheckpoint(session.id);
  if (
    checkpoint?.phase !== "active" ||
    checkpoint.attempt.state !== "running" ||
    checkpoint.attempt.taskState !== "running" ||
    checkpoint.attempt.disposed !== false
  ) {
    throw new Error("P8.2 crash/restart active checkpoint is incomplete");
  }
  writeP8ProductJourneyRestartJournal(input.restartJournalPath, {
    schemaVersion: 1,
    journey: "crash-restart-recovery",
    phase: "active-checkpoint",
    restartCount: 0,
  });
  return Object.freeze({ taskId: submitted.taskId, sessionId: session.id });
}

export interface P8CrashRestartRecoveryVerifyJourneyInput {
  readonly service: Pick<GeneralWorkJourneyService, "list">;
  readonly persistence: Pick<
    ActestraPersistencePort,
    | "loadDomainGraph"
    | "getGeneralWorkCheckpoint"
    | "replayEvents"
    | "listRecentAgentAttemptEvidence"
  >;
  readonly startupRecovery: readonly GeneralWorkRecoveryResult[];
  readonly restartJournalPath: string;
  readonly verifyNoDuplicateRecovery: () => Promise<readonly GeneralWorkRecoveryResult[]>;
}

export async function runP8CrashRestartRecoveryVerifyJourney(
  input: P8CrashRestartRecoveryVerifyJourneyInput,
): Promise<void> {
  let journal: P8ProductJourneyRestartJournal | null = null;
  try {
    journal = parseP8ProductJourneyRestartJournal(
      JSON.parse(fs.readFileSync(input.restartJournalPath, "utf8")),
    );
  } catch {
    journal = null;
  }
  if (journal?.phase !== "active-checkpoint" || journal.restartCount !== 0) {
    throw new Error("P8.2 crash/restart journal did not prove one prepared launch");
  }
  if (input.startupRecovery.length !== 1) {
    throw new Error("P8.2 crash/restart recovered more than one attempt");
  }
  const recovered = input.startupRecovery[0]!;
  if (
    recovered.recoveredFrom !== "active" ||
    recovered.checkpoint.phase !== "finalized" ||
    recovered.checkpoint.attempt.state !== "failed" ||
    recovered.checkpoint.attempt.taskState !== "failed" ||
    recovered.checkpoint.attempt.disposed !== true ||
    recovered.checkpoint.attempt.incident?.code !== "application-restart" ||
    recovered.evidenceStatus !== "appended" ||
    recovered.eventStatuses.some((status) => status !== "appended")
  ) {
    throw new Error("P8.2 crash/restart recovery result is incomplete");
  }
  const graph = await input.persistence.loadDomainGraph();
  const task = graph.tasks.find(
    (candidate) => candidate.id === recovered.checkpoint.attempt.taskId,
  );
  const session = graph.sessions.find((candidate) => candidate.id === recovered.sessionId);
  const worker =
    session === undefined
      ? undefined
      : graph.workers.find((candidate) => candidate.id === session.workerId);
  if (task?.state !== "failed" || session?.state !== "failed" || worker?.state !== "stopped") {
    throw new Error("P8.2 crash/restart durable graph is incomplete");
  }
  const projection = (await input.service.list(P8_CRASH_RESTART_CONVERSATION_ID, 1)).find(
    (candidate) => candidate.taskId === recovered.checkpoint.attempt.taskId,
  );
  if (
    projection?.status !== "failed" ||
    projection.incidentCode !== "application-restart" ||
    projection.canCancel
  ) {
    throw new Error("P8.2 crash/restart projection is incomplete");
  }
  const eventsBefore = await input.persistence.replayEvents(recovered.checkpoint.attempt.streamId);
  if (
    eventsBefore.filter((event) => event.type === "worker.failed").length !== 1 ||
    eventsBefore.filter((event) => event.type === "task.failed").length !== 1 ||
    eventsBefore.some((event) => event.type === "tool.completed")
  ) {
    throw new Error("P8.2 crash/restart event history is ambiguous");
  }
  const evidenceBefore = (await input.persistence.listRecentAgentAttemptEvidence(50)).filter(
    (evidence) => evidence.sessionId === recovered.sessionId,
  );
  if (evidenceBefore.length !== 1 || evidenceBefore[0]?.incident?.code !== "application-restart") {
    throw new Error("P8.2 crash/restart evidence is incomplete");
  }
  const duplicate = await input.verifyNoDuplicateRecovery();
  if (duplicate.length !== 0) throw new Error("P8.2 crash/restart replayed a durable effect");
  const eventsAfter = await input.persistence.replayEvents(recovered.checkpoint.attempt.streamId);
  const evidenceAfter = (await input.persistence.listRecentAgentAttemptEvidence(50)).filter(
    (evidence) => evidence.sessionId === recovered.sessionId,
  );
  if (
    eventsAfter.length !== eventsBefore.length ||
    evidenceAfter.length !== evidenceBefore.length
  ) {
    throw new Error("P8.2 crash/restart duplicate recovery changed durable counts");
  }
  writeP8ProductJourneyRestartJournal(input.restartJournalPath, {
    schemaVersion: 1,
    journey: "crash-restart-recovery",
    phase: "recovered",
    restartCount: 1,
  });
}

/**
 * Exercise the existing coding service's cancellation barrier. The journey
 * only admits a result after Main has cancelled the live session, awaited its
 * completion, and reconciled the durable Task/Session/Worker state. It never
 * creates a worker or deletes arbitrary managed-root entries.
 */
export async function runP8CancellationNoOrphanJourney(
  input: P8CancellationNoOrphanJourneyInput,
): Promise<void> {
  const workspaceRoot = requireCanonicalDirectory(
    input.workspaceRoot,
    "P8.2 cancellation workspace is invalid",
  );
  const managedRoot = requireCanonicalDirectory(
    input.managedRoot,
    "P8.2 cancellation managed root is invalid",
  );
  const sourceProofPath = path.join(workspaceRoot, P8_PRODUCT_JOURNEY_FILE);
  if (fs.existsSync(sourceProofPath)) {
    throw new Error("P8.2 cancellation source workspace is not pristine");
  }
  const managedBefore = new Map(
    fs
      .readdirSync(managedRoot, { withFileTypes: true })
      .map((entry) => [
        entry.name,
        entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      ]),
  );
  const submitted = await input.service.submitFromTrustedContext(
    Object.freeze({
      contractVersion: 1 as const,
      nativeConversationId: P8_CANCELLATION_CONVERSATION_ID,
      submissionId: P8_CANCELLATION_SUBMISSION_ID,
      prompt: P8_CANCELLATION_PROMPT,
    }),
    Object.freeze({
      rootPath: workspaceRoot,
      displayName: "Actestra P8.2 cancellation workspace",
    }),
  );
  const deadline = Date.now() + P8_CANCELLATION_TIMEOUT_MS;
  let current: { readonly status: string; readonly canCancel: boolean } | undefined;
  while (Date.now() < deadline) {
    const projection = (await input.service.list(P8_CANCELLATION_CONVERSATION_ID, 1)).find(
      (candidate) => candidate.taskId === submitted.taskId,
    );
    if (projection !== undefined) {
      current = projection;
      if (projection.canCancel) break;
      if (
        projection.status === "completed" ||
        projection.status === "failed" ||
        projection.status === "cancelled"
      ) {
        throw new Error("P8.2 cancellation journey did not expose an active attempt");
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  if (current?.canCancel !== true) {
    throw new Error("P8.2 cancellation journey timed out before an active attempt");
  }
  await input.service.cancel(
    P8_CANCELLATION_CONVERSATION_ID,
    submitted.taskId,
    "P8.2 bounded cancellation acceptance",
  );
  await input.service.waitForIdle(submitted.taskId);
  const terminal = (await input.service.list(P8_CANCELLATION_CONVERSATION_ID, 1)).find(
    (candidate) => candidate.taskId === submitted.taskId,
  );
  if (terminal?.status !== "cancelled" || terminal.canCancel) {
    throw new Error("P8.2 cancellation journey did not reach durable cancelled state");
  }
  const graph = await input.persistence.loadDomainGraph();
  if (
    !isRecord(graph) ||
    !Array.isArray(graph.tasks) ||
    !Array.isArray(graph.sessions) ||
    !Array.isArray(graph.workers)
  ) {
    throw new Error("P8.2 cancellation durable graph is invalid");
  }
  const task = graph.tasks.find(
    (candidate) => isRecord(candidate) && candidate.id === submitted.taskId,
  );
  const sessions = graph.sessions.filter(
    (candidate) => isRecord(candidate) && candidate.taskId === submitted.taskId,
  );
  const session = sessions[0];
  const worker =
    session === undefined
      ? undefined
      : graph.workers.find((candidate) => isRecord(candidate) && candidate.id === session.workerId);
  if (
    !isRecord(task) ||
    task.state !== "cancelled" ||
    sessions.length !== 1 ||
    !isRecord(session) ||
    session.state !== "cancelled" ||
    !isRecord(worker) ||
    worker.state !== "stopped"
  ) {
    throw new Error("P8.2 cancellation durable cleanup state is incomplete");
  }
  if (fs.existsSync(sourceProofPath)) {
    throw new Error("P8.2 cancellation changed the source workspace");
  }
  const managedAfter = new Map(
    fs
      .readdirSync(managedRoot, { withFileTypes: true })
      .map((entry) => [
        entry.name,
        entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      ]),
  );
  if (
    managedBefore.size !== managedAfter.size ||
    [...managedBefore].some(([name, kind]) => managedAfter.get(name) !== kind) ||
    [...managedAfter].some(([name]) => !managedBefore.has(name))
  ) {
    throw new Error("P8.2 cancellation left an isolated managed-root orphan");
  }
}

type P8WorkspaceApplyArtifactService = Pick<
  AionUiCodingArtifactService,
  "applyArtifact" | "resolveArtifactApply"
>;

export interface P8WorkspaceApplyApprovalJourneyInput {
  readonly service: P8WorkspaceApplyArtifactService;
  readonly persistence: Pick<
    ActestraPersistencePort,
    "loadDomainGraph" | "getArtifactDelivery" | "getActiveWorkspaceGrant"
  >;
  /** The canonical checkout that receives the reviewed patch after approval. */
  readonly workspaceRoot: string;
}

function requireApplyDestinationGrant(
  grant: WorkspaceGrant | null,
  delivery: ArtifactDeliveryRecord,
  workspaceRoot: string,
): WorkspaceGrant {
  if (
    grant === null ||
    grant.state !== "active" ||
    grant.rootPath !== workspaceRoot ||
    delivery.destinationWorkspaceId === null ||
    grant.workspaceId !== delivery.destinationWorkspaceId ||
    grant.grantId === delivery.patchOwnerGrantId
  ) {
    throw new Error("P8.2 Workspace Apply destination grant is invalid");
  }
  return grant;
}

/**
 * Exercise the Main-owned Workspace Apply path against the Artifact produced by the Goose journey.
 * Calling Apply only creates a pending approval; the explicit approved decision is the sole point at
 * which the original checkout may change. The function deliberately re-reads durable state at each
 * boundary so a mocked or stale projection cannot turn into packaged evidence.
 */
export async function runP8WorkspaceApplyApprovalJourney(
  input: P8WorkspaceApplyApprovalJourneyInput,
): Promise<void> {
  const workspaceRoot = requireCanonicalDirectory(
    input.workspaceRoot,
    "P8.2 Workspace Apply destination workspace is invalid",
  );
  const identities = deriveAionUiCodingJourneyIdentities(
    P8_GOOSE_PATCH_CONVERSATION_ID,
    P8_GOOSE_PATCH_SUBMISSION_ID,
  );
  const graph = await input.persistence.loadDomainGraph();
  const task = graph.tasks.find((candidate) => candidate.id === identities.taskId);
  const artifacts = graph.artifacts.filter(
    (candidate) =>
      candidate.taskId === identities.taskId &&
      candidate.label === "Actestra coding patch" &&
      candidate.state === "available",
  );
  if (task?.state !== "completed" || artifacts.length !== 1) {
    throw new Error("P8.2 Workspace Apply requires one completed Goose Patch Artifact");
  }
  const artifact = artifacts[0]!;
  const initialDelivery = await input.persistence.getArtifactDelivery(artifact.id);
  if (initialDelivery === null || initialDelivery.destinationWorkspaceId === null) {
    throw new Error("P8.2 Workspace Apply Artifact has no destination workspace binding");
  }
  const destination = requireApplyDestinationGrant(
    await input.persistence.getActiveWorkspaceGrant(initialDelivery.destinationWorkspaceId),
    initialDelivery,
    workspaceRoot,
  );
  if (destination.grantId === initialDelivery.patchOwnerGrantId) {
    throw new Error("P8.2 Workspace Apply reused the isolated patch-owner grant");
  }

  const proofPath = path.join(workspaceRoot, P8_PRODUCT_JOURNEY_FILE);
  if (fs.existsSync(proofPath)) {
    throw new Error("P8.2 Workspace Apply destination is not pristine before approval");
  }

  const requested = await input.service.applyArtifact(artifact.id);
  if (typeof requested.approvalId !== "string" || requested.approvalId.trim().length === 0) {
    throw new Error("P8.2 Workspace Apply did not return a bounded approval identity");
  }
  // The service must expose a pending approval before this journey can continue. In particular, the
  // original checkout must still be byte-for-byte untouched at this point.
  if (fs.existsSync(proofPath)) {
    throw new Error("P8.2 Workspace Apply wrote the destination before approval");
  }
  const pending = await input.persistence.getArtifactDelivery(artifact.id);
  if (
    pending === null ||
    pending.state !== "applying" ||
    pending.approvalId !== requested.approvalId ||
    pending.destinationGrantId !== destination.grantId ||
    pending.patchOwnerGrantId === pending.destinationGrantId
  ) {
    throw new Error("P8.2 Workspace Apply pending approval evidence is incomplete");
  }

  await input.service.resolveArtifactApply(requested.approvalId, "approved");
  const applied = await input.persistence.getArtifactDelivery(artifact.id);
  if (
    applied === null ||
    applied.state !== "applied" ||
    applied.approvalId !== requested.approvalId ||
    applied.destinationGrantId !== destination.grantId ||
    applied.verifiedHead === null ||
    applied.verifiedHead !== applied.baseCommit ||
    applied.patchOwnerGrantId === applied.destinationGrantId ||
    !fs.existsSync(proofPath) ||
    fs.readFileSync(proofPath, "utf8") !== P8_PRODUCT_JOURNEY_FILE_CONTENT
  ) {
    throw new Error("P8.2 Workspace Apply durable applied evidence is incomplete");
  }

  const projection = projectArtifactDelivery(applied);
  if (
    projection.deliveryState !== "applied" ||
    projection.baseCommit !== applied.baseCommit ||
    projection.changedFileCount !== applied.changedFileCount
  ) {
    throw new Error("P8.2 Workspace Apply projection is incomplete");
  }
  const serializedProjection = JSON.stringify(projection);
  if (
    serializedProjection.includes(workspaceRoot) ||
    serializedProjection.includes(applied.patchReference) ||
    serializedProjection.includes(P8_PRODUCT_JOURNEY_FILE_CONTENT) ||
    serializedProjection.includes(applied.patchOwnerGrantId)
  ) {
    throw new Error("P8.2 Workspace Apply projection contains private patch authority");
  }

  // Applying the same Artifact a second time must be refused by the durable delivery authority; a
  // smoke harness that silently accepts a duplicate would not prove idempotence.
  let duplicateAccepted = false;
  try {
    await input.service.applyArtifact(artifact.id);
    duplicateAccepted = true;
  } catch {
    // Expected terminal conflict.
  }
  if (duplicateAccepted) {
    throw new Error("P8.2 Workspace Apply accepted a duplicate applied Artifact");
  }
}

const P8_TEAM_NAME = "Actestra P8.2 General + Goose Team" as const;
const P8_TEAM_GOAL =
  "Coordinate one bounded General brief and one isolated Goose patch, then review the aggregated result." as const;
const P8_TEAM_FEEDBACK_NOTE = "The bounded General and Goose Team result is accepted." as const;
const P8_TEAM_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const P8_TEAM_APPROVAL_LIMIT = 8;

function teamBridgeTeam(value: unknown): NativeAionUiTeam {
  if (
    !isRecord(value) ||
    value.experience !== "orchestrated" ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.workspace !== "string" ||
    !Array.isArray(value.assistants) ||
    value.assistants.length < 2
  ) {
    throw new Error("P8.2 Team creation projection is incomplete");
  }
  return value as unknown as NativeAionUiTeam;
}

function teamBridgeAck(value: unknown): NativeAionUiTeamRunAck {
  if (
    !isRecord(value) ||
    value.enqueue_status !== "accepted" ||
    typeof value.message_id !== "string" ||
    !isRecord(value.run) ||
    typeof value.run.team_id !== "string" ||
    typeof value.run.team_run_id !== "string"
  ) {
    throw new Error("P8.2 Team submission projection is incomplete");
  }
  return value as unknown as NativeAionUiTeamRunAck;
}

function teamBridgeState(value: unknown): NativeAionUiTeamRunState {
  if (
    !isRecord(value) ||
    !isRecord(value.submission) ||
    value.submission.authority_source !== "actestra-main-runtime" ||
    !isRecord(value.active_run) ||
    !isRecord(value.active_run.actestra) ||
    value.active_run.actestra.authority !== "Actestra Core" ||
    !Array.isArray(value.active_run.actestra.nodes)
  ) {
    throw new Error("P8.2 Team run projection is incomplete");
  }
  return value as unknown as NativeAionUiTeamRunState;
}

function teamNode(
  state: NativeAionUiTeamRunState,
  capability: "general" | "coding" | "feedback",
): NativeAionUiTeamNodeView {
  const node = state.active_run?.actestra.nodes.find(
    (candidate) => candidate.capability === capability,
  );
  if (node === undefined) throw new Error(`P8.2 Team ${capability} node is missing`);
  return node;
}

async function waitForTeamState(
  authority: P8ProductJourneyTeamAuthority,
  teamIdValue: string,
  predicate: (state: NativeAionUiTeamRunState) => boolean,
  timeoutMs = P8_TEAM_POLL_TIMEOUT_MS,
): Promise<NativeAionUiTeamRunState> {
  const deadline = Date.now() + timeoutMs;
  let latest: NativeAionUiTeamRunState | undefined;
  while (Date.now() < deadline) {
    latest = teamBridgeState(
      await authority.dispatch(Object.freeze({ kind: "run-state", teamId: teamIdValue })),
    );
    if (predicate(latest)) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    latest === undefined
      ? "P8.2 Team run projection did not appear"
      : "P8.2 Team run projection timed out",
  );
}

/**
 * Exercise the one Main-owned Team authority through its native bridge-shaped
 * routes. The downstream composition supplies `dispatch` from its existing
 * AionUiTeamService; this function never constructs a second Team service.
 */
export async function runP8GeneralGooseTeamJourney(
  input: P8GeneralGooseTeamJourneyInput,
): Promise<void> {
  if (
    typeof input.providerId !== "string" ||
    !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u.test(input.providerId) ||
    typeof input.modelId !== "string" ||
    !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u.test(input.modelId)
  ) {
    throw new Error("P8.2 Team model selection is invalid");
  }
  const created = teamBridgeTeam(
    await input.authority.dispatch(
      Object.freeze({
        kind: "create",
        experience: "orchestrated" as const,
        name: P8_TEAM_NAME,
        description: "Deterministic packaged General + Goose Team acceptance.",
        workspaceId: input.workspaceId,
        modelSelection: Object.freeze({
          providerId: input.providerId,
          modelId: input.modelId,
        }),
        members: Object.freeze([
          Object.freeze({
            displayName: "General Worker",
            role: "leader" as const,
            capability: "general" as const,
          }),
          Object.freeze({
            displayName: "Goose",
            role: "teammate" as const,
            capability: "coding" as const,
          }),
        ]),
      } satisfies AionUiTeamBridgeRoute),
    ),
  );
  const teamIdValue = created.id;
  const submitted = teamBridgeAck(
    await input.authority.dispatch(
      Object.freeze({
        kind: "send-message",
        teamId: teamIdValue,
        content: P8_TEAM_GOAL,
        files: Object.freeze([]),
        requestNonce: "p8-product-journeys-team-submit",
      } satisfies AionUiTeamBridgeRoute),
    ),
  );
  if (submitted.run.team_id !== teamIdValue) {
    throw new Error("P8.2 Team submission changed the Team identity");
  }
  const runIdValue = submitted.run.team_run_id;
  let state = await waitForTeamState(input.authority, teamIdValue, (candidate) => {
    if (candidate.active_run?.team_run_id !== runIdValue) return false;
    const general = teamNode(candidate, "general");
    const coding = teamNode(candidate, "coding");
    return (
      general.state === "completed" &&
      coding.state === "blocked" &&
      coding.blocked_reason === "protected_approval" &&
      coding.next_actions.includes("approve")
    );
  });

  let approvalCount = 0;
  while (true) {
    const coding = teamNode(state, "coding");
    if (coding.state !== "blocked" || coding.blocked_reason !== "protected_approval") break;
    if (approvalCount >= P8_TEAM_APPROVAL_LIMIT) {
      throw new Error("P8.2 Team Goose approvals exceeded the bounded limit");
    }
    if (!coding.next_actions.includes("approve")) {
      throw new Error("P8.2 Team Goose approval action is missing");
    }
    const decisionState = teamBridgeState(
      await input.authority.dispatch(
        Object.freeze({
          kind: "decide-approval",
          teamId: teamIdValue,
          runId: runIdValue,
          slotId: coding.slot_id,
          decision: "approved" as const,
        } satisfies AionUiTeamBridgeRoute),
      ),
    );
    approvalCount += 1;
    state = decisionState;
    const previousRevision = state.active_run?.actestra.revision ?? 0;
    if (
      teamNode(state, "coding").state === "blocked" &&
      teamNode(state, "coding").blocked_reason === "protected_approval"
    ) {
      state = await waitForTeamState(input.authority, teamIdValue, (candidate) => {
        const nextCoding = teamNode(candidate, "coding");
        const nextRevision = candidate.active_run?.actestra.revision ?? 0;
        return (
          nextRevision > previousRevision ||
          nextCoding.state !== "blocked" ||
          nextCoding.blocked_reason !== "protected_approval"
        );
      });
    }
  }
  if (approvalCount === 0) throw new Error("P8.2 Team Goose never exposed protected Approval");

  const feedbackReady = (candidate: NativeAionUiTeamRunState): boolean => {
    const feedback = teamNode(candidate, "feedback");
    return (
      feedback.state === "blocked" &&
      feedback.blocked_reason === "human_feedback" &&
      feedback.next_actions.includes("approve")
    );
  };
  if (!feedbackReady(state)) {
    state = await waitForTeamState(input.authority, teamIdValue, feedbackReady);
  }
  await input.authority.dispatch(
    Object.freeze({
      kind: "resolve-feedback",
      teamId: teamIdValue,
      runId: runIdValue,
      decision: "approved" as const,
      note: P8_TEAM_FEEDBACK_NOTE,
    } satisfies AionUiTeamBridgeRoute),
  );
  state = await waitForTeamState(
    input.authority,
    teamIdValue,
    (candidate) => candidate.active_run?.actestra.core_status === "completed",
  );

  const general = teamNode(state, "general");
  const coding = teamNode(state, "coding");
  const feedback = teamNode(state, "feedback");
  if (
    state.active_run?.team_run_id !== runIdValue ||
    general.state !== "completed" ||
    coding.state !== "completed" ||
    feedback.state !== "completed" ||
    general.artifacts.length < 1 ||
    coding.artifacts.length < 1 ||
    state.active_run.actestra.result === null ||
    state.active_run.actestra.result.artifacts.length < 2
  ) {
    throw new Error("P8.2 Team completed projection is incomplete");
  }

  const durableTeam = await input.persistence.getTeamDefinition(teamIdValue as never);
  if (
    durableTeam === null ||
    durableTeam.teamId !== teamIdValue ||
    durableTeam.workspaceId !== input.workspaceId
  ) {
    throw new Error("P8.2 Team definition is not durably bound");
  }
  const durableRuns = await input.persistence.listTeamRunsForTeam(teamIdValue as never, 100);
  const durableRun = durableRuns.find((candidate) => candidate.runId === (runIdValue as never));
  if (durableRun === undefined || durableRun.status !== "completed") {
    throw new Error("P8.2 Team run is not durably completed");
  }
  const durableSnapshot = await input.persistence.getTeamRunSnapshot(runIdValue as never);
  if (
    durableSnapshot === null ||
    durableSnapshot.runId !== runIdValue ||
    durableSnapshot.status !== "completed" ||
    durableSnapshot.result === null ||
    durableSnapshot.result.artifacts.length < 2
  ) {
    throw new Error("P8.2 Team result is not durably aggregated");
  }
  const graph = await input.persistence.loadDomainGraph();
  const artifactIds = new Set(durableSnapshot.result.artifacts.map(({ artifactId }) => artifactId));
  const durableArtifacts = graph.artifacts.filter(
    (artifact) => artifactIds.has(artifact.id) && artifact.state === "available",
  );
  if (durableArtifacts.length !== artifactIds.size) {
    throw new Error("P8.2 Team result Artifacts are not durably available");
  }
}

const JOURNEY_RUNNERS: readonly (readonly [
  P8ProductJourneySmokeId,
  keyof Omit<P8ProductJourneySmokeAuthority, "residualProcessCount">,
])[] = Object.freeze([
  ["fresh-profile-launch", "runFreshProfileLaunch"],
  ["general-artifact", "runGeneralArtifact"],
  ["goose-isolated-patch", "runGooseIsolatedPatch"],
  ["workspace-apply-approval", "runWorkspaceApplyApproval"],
  ["general-goose-team", "runGeneralGooseTeam"],
  ["cancellation-no-orphan", "runCancellationNoOrphan"],
  ["crash-restart-recovery", "runCrashRestartRecovery"],
  ["privacy-redaction", "runPrivacyRedaction"],
  ["p7-platform-obligations", "runP7PlatformObligations"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function safeResidualCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 1;
}

function failedJourney(id: P8ProductJourneySmokeId, residualProcessCount: number) {
  return Object.freeze({
    id,
    status: "failed" as const,
    residualProcessCount: Math.max(1, safeResidualCount(residualProcessCount)),
  });
}

function verifiedJourney(id: P8ProductJourneySmokeId) {
  return Object.freeze({ id, status: "verified" as const, residualProcessCount: 0 });
}

function makeResult(
  status: P8ProductJourneySmokeJourneyStatus,
  journeys: readonly P8ProductJourneySmokeJourney[],
): P8ProductJourneySmokeResult {
  const result = Object.freeze({
    schemaVersion: 1 as const,
    status,
    journeys: Object.freeze([...journeys]),
  });
  assertP8ProductJourneySmokeResult(result);
  return result;
}

export function resolveP8ProductJourneySmokeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): P8ProductJourneySmokeConfig | null {
  if (
    environment.ACTESTRA_E2E_TEST !== "1" ||
    environment.ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE !== "1"
  ) {
    return null;
  }
  return Object.freeze({ enabled: true as const });
}

export function assertP8ProductJourneySmokeResult(
  value: unknown,
): asserts value is P8ProductJourneySmokeResult {
  if (!hasExactKeys(value, RESULT_KEYS) || value.schemaVersion !== 1) {
    throw new Error("P8.2 product journey result is invalid");
  }
  if (value.status !== "verified" && value.status !== "failed") {
    throw new Error("P8.2 product journey result is invalid");
  }
  if (
    !Array.isArray(value.journeys) ||
    value.journeys.length !== P8_PRODUCT_JOURNEY_SMOKE_IDS.length
  ) {
    throw new Error("P8.2 product journey result is invalid");
  }
  for (let index = 0; index < P8_PRODUCT_JOURNEY_SMOKE_IDS.length; index += 1) {
    const journey = value.journeys[index];
    const expectedId = P8_PRODUCT_JOURNEY_SMOKE_IDS[index];
    if (
      !hasExactKeys(journey, JOURNEY_KEYS) ||
      journey.id !== expectedId ||
      (journey.status !== "verified" && journey.status !== "failed") ||
      typeof journey.residualProcessCount !== "number" ||
      !Number.isSafeInteger(journey.residualProcessCount) ||
      journey.residualProcessCount < 0 ||
      (journey.status === "verified" && journey.residualProcessCount !== 0)
    ) {
      throw new Error("P8.2 product journey result is invalid");
    }
  }
  if (
    value.status === "verified" &&
    value.journeys.some(
      (journey) => journey.status !== "verified" || journey.residualProcessCount !== 0,
    )
  ) {
    throw new Error("P8.2 product journey result is invalid");
  }
}

/**
 * Execute the fixed product journey sequence. No exception text is retained;
 * the outer packaged controller owns detailed process and artifact evidence.
 */
export async function runP8ProductJourneySmoke(
  config: P8ProductJourneySmokeConfig | null,
  authority: P8ProductJourneySmokeAuthority,
): Promise<P8ProductJourneySmokeResult | null> {
  if (config === null || config.enabled !== true) return null;

  const journeys: P8ProductJourneySmokeJourney[] = [];
  for (let index = 0; index < JOURNEY_RUNNERS.length; index += 1) {
    const [id, method] = JOURNEY_RUNNERS[index]!;
    let residualProcessCount = 0;
    let failed = false;
    try {
      await authority[method]();
    } catch {
      failed = true;
    }
    try {
      residualProcessCount = safeResidualCount(await authority.residualProcessCount());
    } catch {
      residualProcessCount = 1;
    }
    if (failed || residualProcessCount !== 0) {
      journeys.push(failedJourney(id, residualProcessCount));
      for (let remainder = index + 1; remainder < JOURNEY_RUNNERS.length; remainder += 1) {
        journeys.push(failedJourney(JOURNEY_RUNNERS[remainder]![0], residualProcessCount));
      }
      return makeResult("failed", journeys);
    }
    journeys.push(verifiedJourney(id));
  }
  return makeResult("verified", journeys);
}

export function writeP8ProductJourneySmokeResult(
  result: P8ProductJourneySmokeResult,
  resultPath: string,
): void {
  assertP8ProductJourneySmokeResult(result);
  if (typeof resultPath !== "string" || !path.isAbsolute(resultPath)) {
    throw new Error("P8.2 product journey result path is invalid");
  }
  const existing = fs.lstatSync(resultPath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() || existing?.isDirectory()) {
    throw new Error("P8.2 product journey result path is invalid");
  }
  fs.mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });
  const contents = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_RESULT_BYTES) {
    throw new Error("P8.2 product journey result is oversized");
  }
  const temporaryPath = `${resultPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, resultPath);
    fs.chmodSync(resultPath, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary path is absent after a successful rename.
    }
  }
}
