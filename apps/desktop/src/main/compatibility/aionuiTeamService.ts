import { createHash } from "node:crypto";
import {
  ACTESTRA_TEAM_LOCAL_USER_ID,
  assertNativeAionUiTeam,
  assertNativeAionUiTeamRunEvent,
  type AionUiTeamBridgeRoute,
  type AionUiTeamBridgeSuccessData,
  type AionUiTeamEvent,
  type AionUiTeamMemberInput,
  type NativeAionUiTeam,
  type NativeAionUiTeamActivity,
  type NativeAionUiTeamArtifactReference,
  type NativeAionUiTeamAssistant,
  type NativeAionUiTeamNodeView,
  type NativeAionUiTeamRunAck,
  type NativeAionUiTeamRunEvent,
  type NativeAionUiTeamRunState,
  type NativeAionUiTeamSlotWork,
} from "../../compatibility/aionui";
import {
  PersistenceError,
  compareInstants,
  correlationId,
  instant,
  normalizeAdmittedTeamPlan,
  normalizeTeamDefinition,
  teamId,
  teamMemberId,
  teamRunId,
  type ActestraPersistencePort,
  type AdmittedTeamPlan,
  type Instant,
  type TeamDefinition,
  type TeamMember,
  type TeamPlanNodeId,
  type TeamRunNode,
  type TeamRunSnapshot,
} from "../../core";
import { AionUiTeamBridgePortError, type AionUiTeamBridgePort } from "./aionuiTeamBridgeService";
import {
  TeamOrchestratorServiceError,
  type CancelTeamRunInput,
  type CreateTeamRunInput,
  type DecideTeamNodeApprovalInput,
  type ResolveTeamFeedbackInput,
  type TeamNodeControlInput,
} from "../orchestration/teamOrchestratorService";
import { TeamPlanAdmissionServiceError } from "../orchestration/teamPlanAdmissionService";

export interface AionUiTeamPersistencePort extends Pick<
  ActestraPersistencePort,
  | "persistTeamDefinition"
  | "getTeamDefinition"
  | "listTeamDefinitions"
  | "replaceTeamDefinition"
  | "removeTeamDefinition"
  | "getAdmittedTeamPlan"
  | "listTeamRunsForTeam"
> {}

export interface AionUiTeamAdmissionPort {
  propose(request: unknown, signal?: AbortSignal): Promise<AdmittedTeamPlan>;
}

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
  cancelNode(input: TeamNodeControlInput): Promise<TeamRunSnapshot>;
  cancelRun(input: CancelTeamRunInput): Promise<TeamRunSnapshot>;
}

export interface AionUiTeamServiceOptions {
  readonly persistence: AionUiTeamPersistencePort;
  readonly admission: AionUiTeamAdmissionPort | null;
  readonly orchestrator: AionUiTeamOrchestratorPort | null;
  readonly now: () => Instant;
  readonly createDigest: () => string;
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
      | "handoff-node";
  }
>["kind"];

const TERMINAL_RUN_STATUSES = new Set<TeamRunSnapshot["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
    default:
      return node.status;
  }
}

function nodeActions(node: TeamRunNode): NativeAionUiTeamNodeView["next_actions"] {
  switch (node.status) {
    case "running":
      return Object.freeze(["pause", "cancel", "replace", "handoff"]);
    case "approval-blocked":
      return Object.freeze(["approve", "deny", "cancel"]);
    case "paused":
      return Object.freeze(["resume", "cancel", "replace", "handoff"]);
    case "failed":
      return Object.freeze(["retry", "replace", "handoff", "cancel"]);
    case "pending":
    case "ready":
    case "handoff-required":
      return Object.freeze(["cancel"]);
    default:
      return Object.freeze([]);
  }
}

function artifactReference(
  artifact: TeamRunNode["artifacts"][number],
  label: string,
): NativeAionUiTeamArtifactReference {
  return Object.freeze({
    artifact_id: artifact.artifactId,
    kind: artifact.kind,
    label,
  });
}

function projectNode(team: TeamDefinition, node: TeamRunNode): NativeAionUiTeamNodeView {
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
      node.artifacts.map((artifact) => artifactReference(artifact, node.title)),
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
      ["approval-blocked", "paused", "handoff-required", "running", "ready", "failed"].includes(
        status,
      ),
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
    user_id: ACTESTRA_TEAM_LOCAL_USER_ID,
    name: team.name,
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
      status_explanation: statusExplanation(snapshot),
      nodes: Object.freeze(snapshot.nodes.map((node) => projectNode(team, node))),
      result:
        snapshot.result === null
          ? null
          : Object.freeze({
              summary: snapshot.result.summary,
              artifacts: Object.freeze(
                snapshot.result.artifacts.map((artifact) =>
                  artifactReference(artifact, "Team result Artifact"),
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
    return new AionUiTeamBridgePortError(
      error.code === "planner-failed" ? "team-planner-unavailable" : "team-execution-failed",
      "Team plan admission failed",
    );
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
    if (error.code === "team-definition-conflict" || error.code === "team-run-conflict") {
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
  readonly #orchestrator: AionUiTeamOrchestratorPort | null;
  readonly #now: () => Instant;
  readonly #createDigest: () => string;
  readonly #handlers = new Set<(event: AionUiTeamEvent) => void>();
  readonly #unsubscribeOrchestrator: (() => void) | null;
  #closed = false;

  constructor(options: AionUiTeamServiceOptions) {
    this.#persistence = options.persistence;
    this.#admission = options.admission;
    this.#orchestrator = options.orchestrator;
    this.#now = options.now;
    this.#createDigest = options.createDigest;
    instant(this.#now());
    this.#unsubscribeOrchestrator =
      this.#orchestrator?.subscribe((snapshot) => {
        void this.#emitSnapshot(snapshot);
      }) ?? null;
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
    this.#unsubscribeOrchestrator?.();
    this.#handlers.clear();
  }

  async #dispatch(route: AionUiTeamBridgeRoute): Promise<AionUiTeamBridgeSuccessData> {
    switch (route.kind) {
      case "list":
        return this.#list();
      case "create":
        return this.#create(route.name, route.workspaceId, route.members);
      case "get":
        return this.#nativeTeam(await this.#requireTeam(route.teamId));
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
      case "ensure-session":
      case "active-lease":
      case "run-state":
        return this.#runState(route.teamId);
      case "stop-session":
        return this.#stopSession(route.teamId);
      case "set-session-mode":
        return this.#nativeTeam(await this.#requireTeam(route.teamId));
      case "config-options":
        await this.#requireTeam(route.teamId);
        return Object.freeze({ config_options: Object.freeze([]) as readonly [] });
      case "attach-member":
        return this.#attachMember(route.teamId, route.slotId);
      case "send-member-message":
        return this.#sendMemberMessage(route.teamId, route.slotId, route.content);
      case "send-message":
        return this.#sendMessage(route.teamId, route.content);
      case "cancel-run":
        return this.#cancelRun(route.teamId, route.runId, route.reason);
      case "cancel-node":
      case "pause-node":
      case "resume-node":
      case "retry-node":
      case "replace-node":
      case "handoff-node":
        return this.#controlNode(route);
      case "decide-approval":
        return this.#decideApproval(route.teamId, route.runId, route.slotId, route.decision);
      case "resolve-feedback":
        return this.#resolveFeedback(route.teamId, route.runId, route.decision, route.note);
    }
  }

  async #list(): Promise<readonly NativeAionUiTeam[]> {
    const teams = await this.#persistence.listTeamDefinitions(100);
    return Object.freeze(await Promise.all(teams.map((team) => this.#nativeTeam(team))));
  }

  async #create(
    name: string,
    workspaceId: string,
    members: readonly AionUiTeamMemberInput[],
  ): Promise<NativeAionUiTeam> {
    const createdAt = instant(this.#now());
    const rawDigest = this.#createDigest();
    if (!/^[a-f0-9]{64}$/u.test(rawDigest)) {
      throw new AionUiTeamBridgePortError("team-execution-failed", "Team identity source failed");
    }
    const stableTeamId = teamId(`team-${rawDigest}`);
    const team = normalizeTeamDefinition({
      contractVersion: 1,
      teamId: stableTeamId,
      name,
      workspaceId,
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
    const native = await this.#nativeTeam(stored.team);
    this.#emit({ type: "team.created", payload: { team_id: team.teamId, team_name: team.name } });
    this.#emit({ type: "team.listChanged", payload: { team_id: team.teamId, action: "created" } });
    return native;
  }

  async #remove(teamIdValue: string): Promise<null> {
    const team = await this.#requireTeam(teamIdValue);
    await this.#assertNoActiveRun(team.teamId);
    await this.#persistence.removeTeamDefinition(team, this.#nextUpdate(team));
    this.#emit({ type: "team.removed", payload: { team_id: team.teamId } });
    this.#emit({ type: "team.listChanged", payload: { team_id: team.teamId, action: "removed" } });
    return null;
  }

  async #renameTeam(teamIdValue: string, name: string): Promise<NativeAionUiTeam> {
    const team = await this.#requireTeam(teamIdValue);
    const replacement = normalizeTeamDefinition({
      ...team,
      name,
      updatedAt: this.#nextUpdate(team),
    });
    const result = await this.#persistence.replaceTeamDefinition(team, replacement);
    this.#emit({ type: "team.renamed", payload: { team_id: team.teamId, team_name: name } });
    this.#emit({ type: "team.listChanged", payload: { team_id: team.teamId, action: "renamed" } });
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
    this.#emit({ type: "team.agentSpawned", payload: { team_id: team.teamId, assistant } });
    this.#emit({
      type: "team.listChanged",
      payload: { team_id: team.teamId, action: "agent_added" },
    });
    return assistant;
  }

  async #removeMember(teamIdValue: string, slotIdValue: string): Promise<void> {
    const team = await this.#requireTeam(teamIdValue);
    const stableSlotId = teamMemberId(slotIdValue);
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
  ): Promise<NativeAionUiTeamAssistant> {
    const team = await this.#requireTeam(teamIdValue);
    const stableSlotId = teamMemberId(slotIdValue);
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
  ): Promise<NativeAionUiTeamAssistant> {
    const team = await this.#requireTeam(teamIdValue);
    const stableSlotId = teamMemberId(slotIdValue);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const snapshot = await this.#latestRun(team.teamId);
    return projectAssistant(team, snapshot, member);
  }

  async #sendMemberMessage(
    teamIdValue: string,
    slotIdValue: string,
    content: string,
  ): Promise<null> {
    const team = await this.#requireTeam(teamIdValue);
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

  async #sendMessage(teamIdValue: string, content: string): Promise<NativeAionUiTeamRunAck> {
    const team = await this.#requireTeam(teamIdValue);
    if (this.#admission === null || this.#orchestrator === null) {
      throw new AionUiTeamBridgePortError(
        "team-planner-unavailable",
        "Team planning is unavailable",
      );
    }
    await this.#assertNoActiveRun(team.teamId);
    const existingRuns = await this.#persistence.listTeamRunsForTeam(team.teamId, 100);
    const plan = await this.#admission.propose({
      protocolVersion: 1,
      correlationId: correlationId(
        `correlation-team-ui-${digest(`${team.teamId}:${String(existingRuns.length + 1)}:${content}`)}`,
      ),
      planVersion: 1,
      goal: content,
      workerCapabilities: Object.freeze([
        ...new Set(team.members.map(({ capability }) => capability)),
      ]),
      contextReferences: Object.freeze([
        Object.freeze({ referenceId: team.workspaceId, classification: "internal" }),
      ]),
      limits: Object.freeze({
        maxNodes: 5,
        maxDepth: 4,
        maxConcurrency: 2,
        maxTotalAttempts: 10,
      }),
    });
    const accepted = await this.#orchestrator.create({
      team,
      planId: plan.planId,
      occurredAt: instant(this.#now()),
    });
    const started = await this.#orchestrator.start(accepted.runId, instant(this.#now()));
    return Object.freeze({
      enqueue_status: "accepted",
      message_id: teamMessageId(started, content),
      run: projectRunEvent(team, started, "user_message"),
    });
  }

  async #runState(teamIdValue: string): Promise<NativeAionUiTeamRunState> {
    const team = await this.#requireTeam(teamIdValue);
    const snapshot = await this.#latestRun(team.teamId);
    return this.#projectRunState(team, snapshot);
  }

  async #stopSession(teamIdValue: string): Promise<NativeAionUiTeamRunState> {
    const team = await this.#requireTeam(teamIdValue);
    const snapshot = await this.#latestRun(team.teamId);
    if (snapshot === null || TERMINAL_RUN_STATUSES.has(snapshot.status)) {
      return this.#projectRunState(team, snapshot);
    }
    if (this.#orchestrator === null) {
      throw new AionUiTeamBridgePortError("team-unavailable", "Team orchestrator is unavailable");
    }
    const cancelled = await this.#orchestrator.cancelRun({
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
  ): Promise<NativeAionUiTeamRunState> {
    const { team, snapshot } = await this.#requireRun(teamIdValue, runIdValue);
    const orchestrator = this.#requireOrchestrator();
    const cancelled = await orchestrator.cancelRun({
      runId: snapshot.runId,
      reason,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, cancelled);
  }

  async #controlNode(
    route: Extract<AionUiTeamBridgeRoute, { kind: TeamControlKind }>,
  ): Promise<NativeAionUiTeamRunState> {
    const { team, snapshot } = await this.#requireRun(route.teamId, route.runId);
    const node = this.#nodeForSlot(team, snapshot, route.slotId, route.kind);
    const input: TeamNodeControlInput = {
      runId: snapshot.runId,
      nodeId: node.nodeId,
      reason: route.reason,
      occurredAt: instant(this.#now()),
    };
    const orchestrator = this.#requireOrchestrator();
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
    const next = await this.#requireOrchestrator().decideApproval({
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
    const node = snapshot.nodes.find(
      (candidate) => candidate.kind === "human-feedback" && candidate.status === "ready",
    );
    if (node === undefined) {
      throw new AionUiTeamBridgePortError("team-conflict", "Team feedback is not ready");
    }
    const next = await this.#requireOrchestrator().resolveFeedback({
      runId: snapshot.runId,
      nodeId: node.nodeId,
      decision,
      note,
      occurredAt: instant(this.#now()),
    });
    return this.#projectRunState(team, next);
  }

  #nodeForSlot(
    team: TeamDefinition,
    snapshot: TeamRunSnapshot,
    slotIdValue: string,
    action: TeamControlKind | "decide-approval",
  ): TeamRunNode {
    const stableSlotId = teamMemberId(slotIdValue);
    const member = team.members.find(({ memberId }) => memberId === stableSlotId);
    if (member === undefined) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team member does not exist");
    }
    const allowed =
      action === "decide-approval"
        ? ["approval-blocked"]
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
  ): Promise<{ readonly team: TeamDefinition; readonly snapshot: TeamRunSnapshot }> {
    const team = await this.#requireTeam(teamIdValue);
    const stableRunId = teamRunId(runIdValue);
    const snapshot =
      this.#orchestrator === null
        ? (await this.#persistence.listTeamRunsForTeam(team.teamId, 100)).find(
            ({ runId }) => runId === stableRunId,
          )
        : await this.#orchestrator.get(stableRunId);
    if (snapshot === undefined || snapshot.teamId !== team.teamId) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team run does not exist");
    }
    return { team, snapshot };
  }

  async #requireTeam(teamIdValue: string): Promise<TeamDefinition> {
    const stableTeamId = teamId(teamIdValue);
    const team = await this.#persistence.getTeamDefinition(stableTeamId);
    if (team === null) {
      throw new AionUiTeamBridgePortError("team-not-found", "Team does not exist");
    }
    return normalizeTeamDefinition(JSON.parse(JSON.stringify(team)));
  }

  #requireOrchestrator(): AionUiTeamOrchestratorPort {
    if (this.#orchestrator === null) {
      throw new AionUiTeamBridgePortError("team-unavailable", "Team orchestrator is unavailable");
    }
    return this.#orchestrator;
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
      active_run: snapshot === null ? null : projectRunEvent(team, snapshot, "system_lifecycle"),
      slot_work: Object.freeze(team.members.map((member) => projectSlot(team, snapshot, member))),
      activities: snapshot === null ? Object.freeze([]) : await this.#projectActivities(snapshot),
    });
  }

  async #projectActivities(
    snapshot: TeamRunSnapshot,
  ): Promise<readonly NativeAionUiTeamActivity[]> {
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
      content: plan.goal,
      tone: "user",
      occurred_at: toMillis(snapshot.createdAt),
    });
    const workerActivities = snapshot.nodes
      .flatMap((node): readonly NativeAionUiTeamActivity[] => {
        if (node.kind !== "worker" || node.summary === null) return [];
        const occurredAt = node.attempts.at(-1)?.updatedAt ?? snapshot.updatedAt;
        const artifactCount = node.artifacts.length;
        return [
          Object.freeze({
            id: `team-activity-${digest(`${snapshot.runId}:${node.nodeId}:${occurredAt}:${String(artifactCount)}`)}`,
            author: node.capability === "general" ? "General Worker" : "Goose",
            content: `${node.title} completed with ${String(artifactCount)} durable Artifact ${artifactCount === 1 ? "reference" : "references"}.`,
            tone: "worker",
            occurred_at: toMillis(occurredAt),
          }),
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
        payload: projectRunEvent(team, snapshot, "system_lifecycle"),
      } as AionUiTeamEvent);
    } catch {
      // Projection failure cannot change or interrupt persisted orchestration.
    }
  }
}
