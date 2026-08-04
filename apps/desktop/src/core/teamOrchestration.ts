import {
  correlationId,
  taskId,
  type ArtifactKind,
  type CorrelationId,
  type TaskId,
} from "./domain";

declare const teamPlanValueBrand: unique symbol;

type TeamPlanBrandedString<Brand extends string> = string & {
  readonly [teamPlanValueBrand]: Brand;
};

export type TeamPlanId = TeamPlanBrandedString<"TeamPlanId">;
export type TeamPlanNodeId = TeamPlanBrandedString<"TeamPlanNodeId">;

export const TEAM_PLANNER_PROTOCOL_VERSION = 1 as const;
export const TEAM_PLAN_MIN_NODES = 3;
export const TEAM_PLAN_MAX_NODES = 5;
export const TEAM_PLAN_MAX_DEPTH = 4;
export const TEAM_PLAN_MAX_CONCURRENCY = 2;
export const TEAM_PLAN_MAX_TOTAL_ATTEMPTS = 10;
export const TEAM_PLAN_MAX_NODE_ATTEMPTS = 3;
export const TEAM_PLAN_MAX_CONTEXT_REFERENCES = 16;
export const TEAM_PLAN_MAX_IDENTIFIER_BYTES = 128;
export const TEAM_PLAN_MAX_TITLE_BYTES = 256;
export const TEAM_PLAN_MAX_GOAL_BYTES = 4_096;
export const TEAM_PLAN_MAX_SUMMARY_BYTES = 4_096;
export const TEAM_PLAN_MAX_COMPLETION_CRITERIA_BYTES = 2_048;
export const TEAM_WORKER_CAPABILITIES = ["general", "coding"] as const;
export const TEAM_CONTEXT_CLASSIFICATIONS = ["public", "internal", "confidential"] as const;
export const TEAM_PLAN_RISK_LEVELS = ["low", "medium", "high"] as const;

export type TeamWorkerCapability = (typeof TEAM_WORKER_CAPABILITIES)[number];
export type TeamContextClassification = (typeof TEAM_CONTEXT_CLASSIFICATIONS)[number];
export type TeamPlanRisk = (typeof TEAM_PLAN_RISK_LEVELS)[number];

export type TeamPlanAdmissionErrorCode =
  | "invalid-request"
  | "incompatible-protocol"
  | "candidate-mismatch"
  | "invalid-candidate"
  | "invalid-dependency"
  | "unsupported-capability"
  | "limit-exceeded"
  | "required-node-missing";

export class TeamPlanAdmissionError extends Error {
  constructor(
    readonly code: TeamPlanAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamPlanAdmissionError";
  }
}

export interface TeamPlannerLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxConcurrency: number;
  readonly maxTotalAttempts: number;
}

export interface TeamPlannerContextReference {
  readonly referenceId: string;
  readonly classification: TeamContextClassification;
}

export interface TeamPlannerRequest {
  readonly protocolVersion: typeof TEAM_PLANNER_PROTOCOL_VERSION;
  readonly correlationId: CorrelationId;
  readonly planVersion: number;
  readonly goal: string;
  readonly workerCapabilities: readonly TeamWorkerCapability[];
  readonly contextReferences: readonly TeamPlannerContextReference[];
  readonly limits: TeamPlannerLimits;
}

interface TeamPlanCandidateNodeBase {
  readonly candidateKey: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly completionCriteria: string;
  readonly risk: TeamPlanRisk;
}

export interface TeamPlanWorkerCandidateNode extends TeamPlanCandidateNodeBase {
  readonly kind: "worker";
  readonly capability: TeamWorkerCapability;
  readonly expectedArtifactKind: ArtifactKind;
  readonly maxAttempts: number;
}

export interface TeamPlanHumanFeedbackCandidateNode extends TeamPlanCandidateNodeBase {
  readonly kind: "human-feedback";
}

export type TeamPlanCandidateNode =
  | TeamPlanWorkerCandidateNode
  | TeamPlanHumanFeedbackCandidateNode;

export interface TeamPlanCandidate {
  readonly protocolVersion: typeof TEAM_PLANNER_PROTOCOL_VERSION;
  readonly correlationId: CorrelationId;
  readonly planVersion: number;
  readonly summary: string;
  readonly nodes: readonly TeamPlanCandidateNode[];
}

interface AdmittedTeamPlanNodeBase extends TeamPlanCandidateNodeBase {
  readonly nodeId: TeamPlanNodeId;
  readonly taskId: TaskId;
  readonly dependsOn: readonly TeamPlanNodeId[];
}

export interface AdmittedTeamPlanWorkerNode extends AdmittedTeamPlanNodeBase {
  readonly kind: "worker";
  readonly capability: TeamWorkerCapability;
  readonly expectedArtifactKind: ArtifactKind;
  readonly maxAttempts: number;
}

export interface AdmittedTeamPlanHumanFeedbackNode extends AdmittedTeamPlanNodeBase {
  readonly kind: "human-feedback";
}

export type AdmittedTeamPlanNode = AdmittedTeamPlanWorkerNode | AdmittedTeamPlanHumanFeedbackNode;

export interface AdmittedTeamPlan {
  readonly protocolVersion: typeof TEAM_PLANNER_PROTOCOL_VERSION;
  readonly planId: TeamPlanId;
  readonly correlationId: CorrelationId;
  readonly version: number;
  readonly goal: string;
  readonly summary: string;
  readonly limits: TeamPlannerLimits;
  readonly nodes: readonly AdmittedTeamPlanNode[];
}

const REQUEST_KEYS = [
  "protocolVersion",
  "correlationId",
  "planVersion",
  "goal",
  "workerCapabilities",
  "contextReferences",
  "limits",
] as const;
const LIMIT_KEYS = ["maxNodes", "maxDepth", "maxConcurrency", "maxTotalAttempts"] as const;
const CONTEXT_REFERENCE_KEYS = ["referenceId", "classification"] as const;
const CANDIDATE_KEYS = [
  "protocolVersion",
  "correlationId",
  "planVersion",
  "summary",
  "nodes",
] as const;
const WORKER_NODE_KEYS = [
  "candidateKey",
  "title",
  "kind",
  "capability",
  "dependsOn",
  "expectedArtifactKind",
  "completionCriteria",
  "risk",
  "maxAttempts",
] as const;
const HUMAN_FEEDBACK_NODE_KEYS = [
  "candidateKey",
  "title",
  "kind",
  "dependsOn",
  "completionCriteria",
  "risk",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

type TeamPlanShapeErrorCode = "invalid-request" | "invalid-candidate";

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function isRoundTrippableUtf8(value: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(
  value: unknown,
  field: string,
  maximumBytes: number,
  code: TeamPlanShapeErrorCode,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    containsControlCharacter(value) ||
    !isRoundTrippableUtf8(value) ||
    value.normalize("NFC") !== value ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new TeamPlanAdmissionError(
      code,
      `${field} must be normalized, unpadded, control-free UTF-8 text of at most ${maximumBytes} bytes`,
    );
  }
  return value;
}

function requirePositiveInteger(
  value: unknown,
  field: string,
  code: TeamPlanShapeErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TeamPlanAdmissionError(code, `${field} must be a positive integer`);
  }
  return value as number;
}

function requireIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
  code: TeamPlanShapeErrorCode,
): number {
  const parsed = requirePositiveInteger(value, field, code);
  if (parsed < minimum || parsed > maximum) {
    throw new TeamPlanAdmissionError(code, `${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function normalizeTeamPlannerRequest(value: unknown): TeamPlannerRequest {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
    throw new TeamPlanAdmissionError("invalid-request", "Team planner request must be a record");
  }
  if (value.protocolVersion !== TEAM_PLANNER_PROTOCOL_VERSION) {
    throw new TeamPlanAdmissionError(
      "incompatible-protocol",
      "Team planner request protocol is incompatible",
    );
  }
  if (
    !Array.isArray(value.workerCapabilities) ||
    !Array.isArray(value.contextReferences) ||
    !isRecord(value.limits) ||
    !hasExactKeys(value.limits, LIMIT_KEYS)
  ) {
    throw new TeamPlanAdmissionError("invalid-request", "Team planner request shape is invalid");
  }
  const capabilities = Array.from(value.workerCapabilities, (capability) => {
    if (!TEAM_WORKER_CAPABILITIES.includes(capability as TeamWorkerCapability)) {
      throw new TeamPlanAdmissionError(
        "invalid-request",
        "Team planner request contains an unknown worker capability",
      );
    }
    return capability as TeamWorkerCapability;
  });
  if (
    capabilities.length === 0 ||
    capabilities.length > TEAM_WORKER_CAPABILITIES.length ||
    new Set(capabilities).size !== capabilities.length
  ) {
    throw new TeamPlanAdmissionError(
      "invalid-request",
      "Team planner worker capabilities must be non-empty and unique",
    );
  }
  if (value.contextReferences.length > TEAM_PLAN_MAX_CONTEXT_REFERENCES) {
    throw new TeamPlanAdmissionError(
      "invalid-request",
      "Team planner request contains too many context references",
    );
  }
  const references = Array.from(value.contextReferences, (reference) => {
    if (
      !isRecord(reference) ||
      !hasExactKeys(reference, CONTEXT_REFERENCE_KEYS) ||
      !TEAM_CONTEXT_CLASSIFICATIONS.includes(reference.classification as TeamContextClassification)
    ) {
      throw new TeamPlanAdmissionError(
        "invalid-request",
        "Team planner context reference is invalid",
      );
    }
    return Object.freeze({
      referenceId: requireText(
        reference.referenceId,
        "Team context reference",
        TEAM_PLAN_MAX_IDENTIFIER_BYTES,
        "invalid-request",
      ),
      classification: reference.classification as TeamContextClassification,
    });
  });
  if (new Set(references.map(({ referenceId }) => referenceId)).size !== references.length) {
    throw new TeamPlanAdmissionError(
      "invalid-request",
      "Team planner context references must be unique",
    );
  }
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_PROTOCOL_VERSION,
    correlationId: correlationId(
      requireText(
        value.correlationId,
        "Team correlation id",
        TEAM_PLAN_MAX_IDENTIFIER_BYTES,
        "invalid-request",
      ),
    ),
    planVersion: requirePositiveInteger(value.planVersion, "Team plan version", "invalid-request"),
    goal: requireText(value.goal, "Team goal", TEAM_PLAN_MAX_GOAL_BYTES, "invalid-request"),
    workerCapabilities: Object.freeze(capabilities),
    contextReferences: Object.freeze(references),
    limits: Object.freeze({
      maxNodes: requireIntegerRange(
        value.limits.maxNodes,
        TEAM_PLAN_MIN_NODES,
        TEAM_PLAN_MAX_NODES,
        "Team maximum node count",
        "invalid-request",
      ),
      maxDepth: requireIntegerRange(
        value.limits.maxDepth,
        2,
        TEAM_PLAN_MAX_DEPTH,
        "Team maximum depth",
        "invalid-request",
      ),
      maxConcurrency: requireIntegerRange(
        value.limits.maxConcurrency,
        2,
        TEAM_PLAN_MAX_CONCURRENCY,
        "Team maximum concurrency",
        "invalid-request",
      ),
      maxTotalAttempts: requireIntegerRange(
        value.limits.maxTotalAttempts,
        TEAM_PLAN_MIN_NODES,
        TEAM_PLAN_MAX_TOTAL_ATTEMPTS,
        "Team maximum attempts",
        "invalid-request",
      ),
    }),
  });
}

function parseCandidateNode(value: unknown): TeamPlanCandidateNode {
  if (!isRecord(value) || !Array.isArray(value.dependsOn)) {
    throw new TeamPlanAdmissionError("invalid-candidate", "Team plan node is invalid");
  }
  if (value.dependsOn.length > TEAM_PLAN_MAX_NODES) {
    throw new TeamPlanAdmissionError(
      "invalid-candidate",
      "Team plan node contains too many dependencies",
    );
  }
  const base = {
    candidateKey: requireText(
      value.candidateKey,
      "Team candidate key",
      TEAM_PLAN_MAX_IDENTIFIER_BYTES,
      "invalid-candidate",
    ),
    title: requireText(
      value.title,
      "Team node title",
      TEAM_PLAN_MAX_TITLE_BYTES,
      "invalid-candidate",
    ),
    dependsOn: Object.freeze(
      Array.from(value.dependsOn, (dependency) =>
        requireText(
          dependency,
          "Team dependency",
          TEAM_PLAN_MAX_IDENTIFIER_BYTES,
          "invalid-candidate",
        ),
      ),
    ),
    completionCriteria: requireText(
      value.completionCriteria,
      "Team completion criteria",
      TEAM_PLAN_MAX_COMPLETION_CRITERIA_BYTES,
      "invalid-candidate",
    ),
    risk: value.risk as TeamPlanRisk,
  };
  if (!TEAM_PLAN_RISK_LEVELS.includes(base.risk)) {
    throw new TeamPlanAdmissionError("invalid-candidate", "Team node risk is invalid");
  }
  if (value.kind === "human-feedback") {
    if (!hasExactKeys(value, HUMAN_FEEDBACK_NODE_KEYS)) {
      throw new TeamPlanAdmissionError(
        "invalid-candidate",
        "Team human-feedback node contains an unknown field",
      );
    }
    return Object.freeze({ ...base, kind: "human-feedback" });
  }
  if (
    value.kind !== "worker" ||
    !hasExactKeys(value, WORKER_NODE_KEYS) ||
    !TEAM_WORKER_CAPABILITIES.includes(value.capability as TeamWorkerCapability) ||
    !["file", "document", "dataset", "directory", "other"].includes(
      value.expectedArtifactKind as string,
    )
  ) {
    throw new TeamPlanAdmissionError("invalid-candidate", "Team worker node is invalid");
  }
  return Object.freeze({
    ...base,
    kind: "worker",
    capability: value.capability as TeamWorkerCapability,
    expectedArtifactKind: value.expectedArtifactKind as ArtifactKind,
    maxAttempts: requireIntegerRange(
      value.maxAttempts,
      1,
      TEAM_PLAN_MAX_NODE_ATTEMPTS,
      "Team worker attempts",
      "invalid-candidate",
    ),
  });
}

function parseCandidate(value: unknown): TeamPlanCandidate {
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS) || !Array.isArray(value.nodes)) {
    throw new TeamPlanAdmissionError("invalid-candidate", "Team plan candidate is invalid");
  }
  if (value.protocolVersion !== TEAM_PLANNER_PROTOCOL_VERSION) {
    throw new TeamPlanAdmissionError(
      "incompatible-protocol",
      "Team plan candidate protocol is incompatible",
    );
  }
  if (value.nodes.length < TEAM_PLAN_MIN_NODES || value.nodes.length > TEAM_PLAN_MAX_NODES) {
    throw new TeamPlanAdmissionError(
      "limit-exceeded",
      "Team plan candidate node count exceeds the first P6 envelope",
    );
  }
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_PROTOCOL_VERSION,
    correlationId: correlationId(
      requireText(
        value.correlationId,
        "Team candidate correlation",
        TEAM_PLAN_MAX_IDENTIFIER_BYTES,
        "invalid-candidate",
      ),
    ),
    planVersion: requirePositiveInteger(
      value.planVersion,
      "Team candidate version",
      "invalid-candidate",
    ),
    summary: requireText(
      value.summary,
      "Team candidate summary",
      TEAM_PLAN_MAX_SUMMARY_BYTES,
      "invalid-candidate",
    ),
    nodes: Object.freeze(Array.from(value.nodes, parseCandidateNode)),
  });
}

function topologicalNodes(
  nodes: readonly TeamPlanCandidateNode[],
): readonly TeamPlanCandidateNode[] {
  const byKey = new Map<string, TeamPlanCandidateNode>();
  for (const node of nodes) {
    if (byKey.has(node.candidateKey)) {
      throw new TeamPlanAdmissionError("invalid-candidate", "Team candidate keys must be unique");
    }
    byKey.set(node.candidateKey, node);
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    incoming.set(node.candidateKey, node.dependsOn.length);
    if (new Set(node.dependsOn).size !== node.dependsOn.length) {
      throw new TeamPlanAdmissionError(
        "invalid-dependency",
        "Team candidate dependency edges must be unique",
      );
    }
    for (const dependency of node.dependsOn) {
      if (!byKey.has(dependency) || dependency === node.candidateKey) {
        throw new TeamPlanAdmissionError(
          "invalid-dependency",
          "Team candidate dependency is missing or self-referential",
        );
      }
      const dependents = outgoing.get(dependency) ?? [];
      dependents.push(node.candidateKey);
      outgoing.set(dependency, dependents);
    }
  }
  const ready = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([key]) => key)
    .sort();
  const ordered: TeamPlanCandidateNode[] = [];
  while (ready.length > 0) {
    const key = ready.shift()!;
    ordered.push(byKey.get(key)!);
    for (const dependent of [...(outgoing.get(key) ?? [])].sort()) {
      const remaining = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (ordered.length !== nodes.length) {
    throw new TeamPlanAdmissionError("invalid-dependency", "Team candidate graph is cyclic");
  }
  return Object.freeze(ordered);
}

function maximumParallelWidth(nodes: readonly TeamPlanCandidateNode[]): number {
  const ancestorsByKey = new Map<string, ReadonlySet<string>>();
  for (const node of nodes) {
    const ancestors = new Set<string>();
    for (const dependency of node.dependsOn) {
      ancestors.add(dependency);
      for (const ancestor of ancestorsByKey.get(dependency) ?? []) {
        ancestors.add(ancestor);
      }
    }
    ancestorsByKey.set(node.candidateKey, ancestors);
  }

  let maximum = 0;
  for (let mask = 1; mask < 2 ** nodes.length; mask += 1) {
    const selected = nodes.filter((_, index) => Math.floor(mask / 2 ** index) % 2 === 1);
    const independent = selected.every((left, leftIndex) =>
      selected.slice(leftIndex + 1).every((right) => {
        const leftAncestors = ancestorsByKey.get(left.candidateKey)!;
        const rightAncestors = ancestorsByKey.get(right.candidateKey)!;
        return !leftAncestors.has(right.candidateKey) && !rightAncestors.has(left.candidateKey);
      }),
    );
    if (independent) {
      maximum = Math.max(maximum, selected.length);
    }
  }
  return maximum;
}

function validateCandidateEnvelope(
  request: TeamPlannerRequest,
  candidate: TeamPlanCandidate,
  ordered: readonly TeamPlanCandidateNode[],
): void {
  if (
    candidate.nodes.length < TEAM_PLAN_MIN_NODES ||
    candidate.nodes.length > TEAM_PLAN_MAX_NODES ||
    candidate.nodes.length > request.limits.maxNodes
  ) {
    throw new TeamPlanAdmissionError(
      "limit-exceeded",
      "Team plan candidate node count exceeds the admitted envelope",
    );
  }

  const workerNodes = ordered.filter(
    (node): node is TeamPlanWorkerCandidateNode => node.kind === "worker",
  );
  for (const node of workerNodes) {
    if (!request.workerCapabilities.includes(node.capability)) {
      throw new TeamPlanAdmissionError(
        "unsupported-capability",
        `Team worker capability ${node.capability} is unavailable`,
      );
    }
  }

  const totalAttempts = workerNodes.reduce((total, node) => total + node.maxAttempts, 0);
  if (totalAttempts > request.limits.maxTotalAttempts) {
    throw new TeamPlanAdmissionError(
      "limit-exceeded",
      "Team plan candidate exceeds the total attempt budget",
    );
  }

  const depthByKey = new Map<string, number>();
  for (const node of ordered) {
    const depth =
      node.dependsOn.length === 0
        ? 1
        : 1 + Math.max(...node.dependsOn.map((dependency) => depthByKey.get(dependency)!));
    depthByKey.set(node.candidateKey, depth);
  }
  const maximumDepth = Math.max(...depthByKey.values());
  const maximumWidth = maximumParallelWidth(ordered);
  if (maximumDepth > request.limits.maxDepth || maximumWidth > request.limits.maxConcurrency) {
    throw new TeamPlanAdmissionError(
      "limit-exceeded",
      "Team plan candidate exceeds depth or concurrency limits",
    );
  }

  const capabilities = new Set(workerNodes.map(({ capability }) => capability));
  const hasFeedback = ordered.some(({ kind }) => kind === "human-feedback");
  if (
    !capabilities.has("general") ||
    !capabilities.has("coding") ||
    !hasFeedback ||
    maximumWidth < 2
  ) {
    throw new TeamPlanAdmissionError(
      "required-node-missing",
      "The first P6 plan requires General, coding, human feedback, and a parallel branch",
    );
  }
}

function canonicalInput(request: TeamPlannerRequest, candidate: TeamPlanCandidate): string {
  return JSON.stringify({
    protocolVersion: TEAM_PLANNER_PROTOCOL_VERSION,
    correlationId: request.correlationId,
    planVersion: request.planVersion,
    goal: request.goal,
    workerCapabilities: [...request.workerCapabilities].sort(),
    contextReferences: [...request.contextReferences].sort((left, right) =>
      compareText(left.referenceId, right.referenceId),
    ),
    limits: request.limits,
    summary: candidate.summary,
    nodes: [...candidate.nodes]
      .sort((left, right) => compareText(left.candidateKey, right.candidateKey))
      .map((node) => ({ ...node, dependsOn: [...node.dependsOn].sort() })),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function teamPlanId(value: string): TeamPlanId {
  return value as TeamPlanId;
}

function teamPlanNodeId(value: string): TeamPlanNodeId {
  return value as TeamPlanNodeId;
}

export async function admitTeamPlanCandidate(
  requestValue: unknown,
  candidateValue: unknown,
): Promise<AdmittedTeamPlan> {
  const request = normalizeTeamPlannerRequest(requestValue);
  const candidate = parseCandidate(candidateValue);
  if (
    candidate.correlationId !== request.correlationId ||
    candidate.planVersion !== request.planVersion
  ) {
    throw new TeamPlanAdmissionError(
      "candidate-mismatch",
      "Team plan candidate does not match the Actestra request",
    );
  }
  const ordered = topologicalNodes(candidate.nodes);
  validateCandidateEnvelope(request, candidate, ordered);
  const planDigest = await sha256Hex(canonicalInput(request, candidate));
  const identityEntries = await Promise.all(
    ordered.map(async (node) => {
      const digest = await sha256Hex(`${planDigest}\u0000${node.candidateKey}`);
      return [
        node.candidateKey,
        Object.freeze({
          nodeId: teamPlanNodeId(`team-node-${digest}`),
          taskId: taskId(`task-team-${digest}`),
        }),
      ] as const;
    }),
  );
  const identities = new Map(identityEntries);
  const admittedNodes = ordered.map((node): AdmittedTeamPlanNode => {
    const identity = identities.get(node.candidateKey)!;
    const base = {
      ...identity,
      candidateKey: node.candidateKey,
      title: node.title,
      dependsOn: Object.freeze(
        [...node.dependsOn].sort().map((dependency) => identities.get(dependency)!.nodeId),
      ),
      completionCriteria: node.completionCriteria,
      risk: node.risk,
    };
    return node.kind === "human-feedback"
      ? Object.freeze({ ...base, kind: "human-feedback" })
      : Object.freeze({
          ...base,
          kind: "worker",
          capability: node.capability,
          expectedArtifactKind: node.expectedArtifactKind,
          maxAttempts: node.maxAttempts,
        });
  });
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_PROTOCOL_VERSION,
    planId: teamPlanId(`team-plan-${planDigest}`),
    correlationId: request.correlationId,
    version: request.planVersion,
    goal: request.goal,
    summary: candidate.summary,
    limits: request.limits,
    nodes: Object.freeze(admittedNodes),
  });
}
