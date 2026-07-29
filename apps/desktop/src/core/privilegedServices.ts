import {
  approvalId,
  compareInstants,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type ApprovalId,
  type ApprovalState,
  type Instant,
  type SessionId,
  type TaskId,
  type ToolRequestId,
  type WorkerId,
  type WorkspaceId,
} from "./domain";

declare const privilegedValueBrand: unique symbol;

type BrandedPrivilegedString<Brand extends string> = string & {
  readonly [privilegedValueBrand]: Brand;
};

export type CredentialReference = BrandedPrivilegedString<"CredentialReference">;
export type CredentialLeaseId = BrandedPrivilegedString<"CredentialLeaseId">;
export type PolicyRevision = BrandedPrivilegedString<"PolicyRevision">;
export type PolicyRuleId = BrandedPrivilegedString<"PolicyRuleId">;
export type PolicyDecisionId = BrandedPrivilegedString<"PolicyDecisionId">;
export type AuthorizationGrantId = BrandedPrivilegedString<"AuthorizationGrantId">;
export type ApprovalActorId = BrandedPrivilegedString<"ApprovalActorId">;
export type AuditRecordId = BrandedPrivilegedString<"AuditRecordId">;
export type ToolId = BrandedPrivilegedString<"ToolId">;
export type ToolInputReference = BrandedPrivilegedString<"ToolInputReference">;
export type ToolOutputReference = BrandedPrivilegedString<"ToolOutputReference">;

export const PRIVILEGED_CONTRACT_VERSION = 1 as const;

export const PROTECTED_ACTIONS = [
  "workspace.read",
  "artifact.create",
  "workspace.modify",
  "workspace.delete",
  "shell.execute",
  "system.change",
  "network.request",
  "message.send",
  "publish.execute",
  "git.push",
  "credential.use",
  "tool.invoke",
] as const;

export type ProtectedAction = (typeof PROTECTED_ACTIONS)[number];

export const PROTECTED_RESOURCE_KINDS = [
  "workspace",
  "task-output",
  "repository",
  "external-service",
  "system",
] as const;

export type ProtectedResourceKind = (typeof PROTECTED_RESOURCE_KINDS)[number];
export type CredentialUseMatch = "none" | "required" | "any";
export type ToolCredentialUse = "forbidden" | "optional" | "required";
export type PolicyEffect = "allow" | "require-approval" | "deny";
export type PolicyDecisionReason =
  | "matching-rule-allow"
  | "matching-rule-approval"
  | "matching-rule-deny"
  | "no-matching-rule";
export type AuthorizationMethod = "policy" | "approval";

export type PrivilegedServiceErrorCode =
  | "invalid-contract"
  | "invalid-policy"
  | "invalid-manifest"
  | "invalid-audit"
  | "policy-unavailable"
  | "policy-denied"
  | "manifest-unavailable"
  | "manifest-mismatch"
  | "approval-not-found"
  | "approval-mismatch"
  | "approval-expired"
  | "approval-not-granted"
  | "approval-replayed"
  | "audit-unavailable"
  | "credential-unavailable"
  | "credential-release-failed"
  | "tool-execution-failed"
  | "post-execution-audit-failed";

export class PrivilegedServiceError extends Error {
  readonly mayHaveExecuted: boolean;

  constructor(
    readonly code: PrivilegedServiceErrorCode,
    message: string,
    options?: ErrorOptions & {
      readonly mayHaveExecuted?: boolean;
    },
  ) {
    super(message, options);
    this.name = "PrivilegedServiceError";
    this.mayHaveExecuted = options?.mayHaveExecuted ?? false;
  }
}

export class ProtectedToolExecutionError extends Error {
  readonly mayHaveExecuted: boolean;

  constructor(
    readonly errorCode: string,
    message: string,
    options?: ErrorOptions & {
      readonly mayHaveExecuted?: boolean;
    },
  ) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(errorCode) || errorCode.length > 128) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Protected tool execution errorCode must be a stable lowercase code",
      );
    }
    super(message, options);
    this.name = "ProtectedToolExecutionError";
    this.mayHaveExecuted = options?.mayHaveExecuted ?? false;
  }
}

function privilegedIdentifier<Identifier extends string>(
  value: unknown,
  label: string,
): Identifier {
  if (typeof value !== "string") {
    throw new PrivilegedServiceError("invalid-contract", `${label} must be an identifier`);
  }

  try {
    correlationId(value);
  } catch {
    throw new PrivilegedServiceError("invalid-contract", `${label} is invalid`);
  }

  return value as Identifier;
}

export function credentialReference(value: string): CredentialReference {
  return privilegedIdentifier<CredentialReference>(value, "CredentialReference");
}

export function credentialLeaseId(value: string): CredentialLeaseId {
  return privilegedIdentifier<CredentialLeaseId>(value, "CredentialLeaseId");
}

export function policyRevision(value: string): PolicyRevision {
  return privilegedIdentifier<PolicyRevision>(value, "PolicyRevision");
}

export function policyRuleId(value: string): PolicyRuleId {
  return privilegedIdentifier<PolicyRuleId>(value, "PolicyRuleId");
}

export function policyDecisionId(value: string): PolicyDecisionId {
  return privilegedIdentifier<PolicyDecisionId>(value, "PolicyDecisionId");
}

export function authorizationGrantId(value: string): AuthorizationGrantId {
  return privilegedIdentifier<AuthorizationGrantId>(value, "AuthorizationGrantId");
}

export function approvalActorId(value: string): ApprovalActorId {
  return privilegedIdentifier<ApprovalActorId>(value, "ApprovalActorId");
}

export function auditRecordId(value: string): AuditRecordId {
  return privilegedIdentifier<AuditRecordId>(value, "AuditRecordId");
}

export function toolId(value: string): ToolId {
  return privilegedIdentifier<ToolId>(value, "ToolId");
}

export function toolInputReference(value: string): ToolInputReference {
  return privilegedIdentifier<ToolInputReference>(value, "ToolInputReference");
}

export function toolOutputReference(value: string): ToolOutputReference {
  return privilegedIdentifier<ToolOutputReference>(value, "ToolOutputReference");
}

export interface ProtectedOperation {
  readonly contractVersion: typeof PRIVILEGED_CONTRACT_VERSION;
  readonly requestId: ToolRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly toolId: ToolId;
  readonly inputRef: ToolInputReference;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
  readonly summary: string;
  readonly credentialRefs: readonly CredentialReference[];
  readonly requestedAt: Instant;
}

export interface PolicyRule {
  readonly id: PolicyRuleId;
  readonly effect: PolicyEffect;
  readonly actions: readonly ProtectedAction[];
  readonly resourceKinds: readonly ProtectedResourceKind[];
  readonly credentialUse: CredentialUseMatch;
  readonly toolIds?: readonly ToolId[];
}

export interface PolicySnapshot {
  readonly contractVersion: typeof PRIVILEGED_CONTRACT_VERSION;
  readonly revision: PolicyRevision;
  readonly rules: readonly PolicyRule[];
}

export interface PolicyDecision {
  readonly decisionId: PolicyDecisionId;
  readonly policyRevision: PolicyRevision;
  readonly requestId: ToolRequestId;
  readonly effect: PolicyEffect;
  readonly reasonCode: PolicyDecisionReason;
  readonly matchedRuleIds: readonly PolicyRuleId[];
  readonly evaluatedAt: Instant;
}

export interface ToolCapabilityManifest {
  readonly contractVersion: typeof PRIVILEGED_CONTRACT_VERSION;
  readonly toolId: ToolId;
  readonly actions: readonly ProtectedAction[];
  readonly resourceKinds: readonly ProtectedResourceKind[];
  readonly credentialUse: ToolCredentialUse;
  readonly timeoutMs: number;
}

export interface ApprovalRequestSnapshot {
  readonly approvalId: ApprovalId;
  readonly operation: ProtectedOperation;
  readonly policyRevision: PolicyRevision;
  readonly state: ApprovalState;
  readonly requestedAt: Instant;
  readonly expiresAt: Instant;
  readonly resolvedAt?: Instant;
  readonly resolvedBy?: ApprovalActorId;
  readonly consumedAt?: Instant;
}

export type UserApprovalDecision = "approved" | "denied" | "cancelled";

export interface AuthorizationGrant {
  readonly grantId: AuthorizationGrantId;
  readonly requestId: ToolRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly toolId: ToolId;
  readonly inputRef: ToolInputReference;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
  readonly credentialRefs: readonly CredentialReference[];
  readonly policyDecisionId: PolicyDecisionId;
  readonly policyRevision: PolicyRevision;
  readonly method: AuthorizationMethod;
  readonly approvalId?: ApprovalId;
  readonly issuedAt: Instant;
}

export type AuthorizationResult =
  | {
      readonly status: "approval-required";
      readonly approval: ApprovalRequestSnapshot;
    }
  | {
      readonly status: "granted";
      readonly authorization: AuthorizationGrant;
    };

export interface CredentialLease {
  readonly leaseId: CredentialLeaseId;
  readonly credentialRef: CredentialReference;
  readonly requestId: ToolRequestId;
  readonly authorizationGrantId: AuthorizationGrantId;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}

export interface PrivilegedAuditContext {
  readonly requestId: ToolRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly toolId: ToolId;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
}

export type AuditEvent =
  | {
      readonly type: "policy.evaluated";
      readonly context: PrivilegedAuditContext;
      readonly policyRevision: PolicyRevision;
      readonly decision: PolicyEffect;
      readonly reasonCode: PolicyDecisionReason;
      readonly matchedRuleIds: readonly PolicyRuleId[];
    }
  | {
      readonly type: "approval.requested";
      readonly context: PrivilegedAuditContext;
      readonly approvalId: ApprovalId;
      readonly policyRevision: PolicyRevision;
      readonly expiresAt: Instant;
    }
  | {
      readonly type: "approval.resolved";
      readonly context: PrivilegedAuditContext;
      readonly approvalId: ApprovalId;
      readonly decision: Exclude<ApprovalState, "pending">;
      readonly actorId?: ApprovalActorId;
    }
  | {
      readonly type: "approval.consumed";
      readonly context: PrivilegedAuditContext;
      readonly approvalId: ApprovalId;
      readonly grantId: AuthorizationGrantId;
    }
  | {
      readonly type: "credential.lease-issued";
      readonly context: PrivilegedAuditContext;
      readonly credentialRef: CredentialReference;
      readonly leaseId: CredentialLeaseId;
      readonly grantId: AuthorizationGrantId;
      readonly expiresAt: Instant;
    }
  | {
      readonly type: "credential.lease-released";
      readonly context: PrivilegedAuditContext;
      readonly credentialRef: CredentialReference;
      readonly leaseId: CredentialLeaseId;
      readonly grantId: AuthorizationGrantId;
    }
  | {
      readonly type: "tool.started";
      readonly context: PrivilegedAuditContext;
      readonly authorizationMethod: AuthorizationMethod;
      readonly approvalId?: ApprovalId;
    }
  | {
      readonly type: "tool.completed";
      readonly context: PrivilegedAuditContext;
      readonly outputRef?: ToolOutputReference;
    }
  | {
      readonly type: "tool.failed";
      readonly context: PrivilegedAuditContext;
      readonly errorCode: string;
    };

export interface AuditRecord {
  readonly contractVersion: typeof PRIVILEGED_CONTRACT_VERSION;
  readonly recordId: AuditRecordId;
  readonly sequence: number;
  readonly occurredAt: Instant;
  readonly redaction: "metadata";
  readonly event: AuditEvent;
}

export interface ToolExecutionRequest {
  readonly operation: ProtectedOperation;
  readonly authorization: AuthorizationGrant;
  readonly credentialLeases: readonly CredentialLease[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ToolExecutionResult {
  readonly status: "succeeded";
  readonly outputRef?: ToolOutputReference;
}

export interface PrivilegedClock {
  now(): Instant;
}

export interface PolicyEngine {
  evaluate(operation: ProtectedOperation): Promise<PolicyDecision>;
}

export interface ApprovalService {
  authorize(
    operation: ProtectedOperation,
    decision: PolicyDecision,
    approval?: ApprovalId,
  ): Promise<AuthorizationResult>;
  resolve(
    approval: ApprovalId,
    decision: UserApprovalDecision,
    actor: ApprovalActorId,
  ): Promise<ApprovalRequestSnapshot>;
  get(approval: ApprovalId): Promise<ApprovalRequestSnapshot | undefined>;
}

export interface CredentialBroker {
  lease(
    operation: ProtectedOperation,
    authorization: AuthorizationGrant,
  ): Promise<readonly CredentialLease[]>;
  release(operation: ProtectedOperation, leases: readonly CredentialLease[]): Promise<void>;
}

export interface AuditTrail {
  append(event: AuditEvent): Promise<AuditRecord>;
}

export interface ProtectedToolExecutor {
  manifest(tool: ToolId): Promise<ToolCapabilityManifest>;
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}

export interface ToolInvocationControl {
  readonly signal?: AbortSignal;
}

export type ToolGatewayResult =
  | {
      readonly status: "approval-required";
      readonly decision: PolicyDecision;
      readonly approval: ApprovalRequestSnapshot;
    }
  | {
      readonly status: "executed";
      readonly decision: PolicyDecision;
      readonly authorization: AuthorizationGrant;
      readonly result: ToolExecutionResult;
    };

export interface ToolGateway {
  invoke(
    operation: ProtectedOperation,
    approval?: ApprovalId,
    control?: ToolInvocationControl,
  ): Promise<ToolGatewayResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PrivilegedServiceError(code, `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  code: PrivilegedServiceErrorCode,
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));

  if (unexpected !== undefined) {
    throw new PrivilegedServiceError(code, `${label} contains unsupported field ${unexpected}`);
  }
}

function assertContractVersion(
  value: unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
): void {
  if (value !== PRIVILEGED_CONTRACT_VERSION) {
    throw new PrivilegedServiceError(
      code,
      `${label} requires contract version ${PRIVILEGED_CONTRACT_VERSION}`,
    );
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 31 || (point >= 127 && point <= 159));
  });
}

function assertText(
  value: unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    value.length > maximumLength ||
    hasControlCharacter(value)
  ) {
    throw new PrivilegedServiceError(
      code,
      `${label} must be non-empty, unpadded, control-free text of at most ${maximumLength} characters`,
    );
  }
}

function assertKnownValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
  code: PrivilegedServiceErrorCode,
  label: string,
): asserts value is Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    throw new PrivilegedServiceError(code, `${label} is unsupported`);
  }
}

function assertIdentifier(
  value: unknown,
  factory: (candidate: string) => unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
): void {
  if (typeof value !== "string") {
    throw new PrivilegedServiceError(code, `${label} must be an identifier`);
  }

  try {
    factory(value);
  } catch {
    throw new PrivilegedServiceError(code, `${label} is invalid`);
  }
}

function assertInstant(
  value: unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
): asserts value is Instant {
  assertIdentifier(value, instant, code, label);
}

function assertUniqueKnownValues<Value extends string>(
  value: unknown,
  values: readonly Value[],
  code: PrivilegedServiceErrorCode,
  label: string,
  allowEmpty = false,
): asserts value is readonly Value[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || !values.includes(entry as Value)) ||
    new Set(value).size !== value.length
  ) {
    throw new PrivilegedServiceError(code, `${label} must contain unique supported values`);
  }
}

function assertUniqueIdentifiers(
  value: unknown,
  factory: (candidate: string) => unknown,
  code: PrivilegedServiceErrorCode,
  label: string,
  allowEmpty = true,
): asserts value is readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new PrivilegedServiceError(code, `${label} must be an array`);
  }

  for (const entry of value) {
    assertIdentifier(entry, factory, code, `${label} entry`);
  }

  if (new Set(value).size !== value.length) {
    throw new PrivilegedServiceError(code, `${label} must not contain duplicate identifiers`);
  }
}

export function assertProtectedOperation(value: unknown): asserts value is ProtectedOperation {
  assertRecord(value, "invalid-contract", "Protected operation");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "requestId",
      "workspaceId",
      "taskId",
      "sessionId",
      "workerId",
      "toolId",
      "inputRef",
      "action",
      "resourceKind",
      "summary",
      "credentialRefs",
      "requestedAt",
    ],
    "invalid-contract",
    "Protected operation",
  );
  assertContractVersion(value.contractVersion, "invalid-contract", "Protected operation");
  assertIdentifier(
    value.requestId,
    toolRequestId,
    "invalid-contract",
    "Protected operation.requestId",
  );
  assertIdentifier(
    value.workspaceId,
    workspaceId,
    "invalid-contract",
    "Protected operation.workspaceId",
  );
  assertIdentifier(value.taskId, taskId, "invalid-contract", "Protected operation.taskId");
  assertIdentifier(value.sessionId, sessionId, "invalid-contract", "Protected operation.sessionId");
  assertIdentifier(value.workerId, workerId, "invalid-contract", "Protected operation.workerId");
  assertIdentifier(value.toolId, toolId, "invalid-contract", "Protected operation.toolId");
  assertIdentifier(
    value.inputRef,
    toolInputReference,
    "invalid-contract",
    "Protected operation.inputRef",
  );
  assertKnownValue(
    value.action,
    PROTECTED_ACTIONS,
    "invalid-contract",
    "Protected operation.action",
  );
  assertKnownValue(
    value.resourceKind,
    PROTECTED_RESOURCE_KINDS,
    "invalid-contract",
    "Protected operation.resourceKind",
  );
  assertText(value.summary, "invalid-contract", "Protected operation.summary", 512);
  assertUniqueIdentifiers(
    value.credentialRefs,
    credentialReference,
    "invalid-contract",
    "Protected operation.credentialRefs",
  );
  assertInstant(value.requestedAt, "invalid-contract", "Protected operation.requestedAt");
}

function assertPolicyRule(value: unknown, index: number): asserts value is PolicyRule {
  const label = `Policy rule ${index}`;
  assertRecord(value, "invalid-policy", label);
  assertExactKeys(
    value,
    ["id", "effect", "actions", "resourceKinds", "credentialUse", "toolIds"],
    "invalid-policy",
    label,
  );
  assertIdentifier(value.id, policyRuleId, "invalid-policy", `${label}.id`);
  assertKnownValue(
    value.effect,
    ["allow", "require-approval", "deny"],
    "invalid-policy",
    `${label}.effect`,
  );
  assertUniqueKnownValues(value.actions, PROTECTED_ACTIONS, "invalid-policy", `${label}.actions`);
  assertUniqueKnownValues(
    value.resourceKinds,
    PROTECTED_RESOURCE_KINDS,
    "invalid-policy",
    `${label}.resourceKinds`,
  );
  assertKnownValue(
    value.credentialUse,
    ["none", "required", "any"],
    "invalid-policy",
    `${label}.credentialUse`,
  );
  if (value.toolIds !== undefined) {
    assertUniqueIdentifiers(value.toolIds, toolId, "invalid-policy", `${label}.toolIds`, false);
  }
}

export function assertPolicySnapshot(value: unknown): asserts value is PolicySnapshot {
  assertRecord(value, "invalid-policy", "Policy snapshot");
  assertExactKeys(
    value,
    ["contractVersion", "revision", "rules"],
    "invalid-policy",
    "Policy snapshot",
  );
  assertContractVersion(value.contractVersion, "invalid-policy", "Policy snapshot");
  assertIdentifier(value.revision, policyRevision, "invalid-policy", "Policy snapshot.revision");

  if (!Array.isArray(value.rules)) {
    throw new PrivilegedServiceError("invalid-policy", "Policy snapshot.rules must be an array");
  }

  value.rules.forEach(assertPolicyRule);
  const ruleIds = value.rules.map((rule) => rule.id);
  if (new Set(ruleIds).size !== ruleIds.length) {
    throw new PrivilegedServiceError(
      "invalid-policy",
      "Policy snapshot must not contain duplicate rule identifiers",
    );
  }
}

export function assertPolicyDecision(value: unknown): asserts value is PolicyDecision {
  assertRecord(value, "invalid-policy", "Policy decision");
  assertExactKeys(
    value,
    [
      "decisionId",
      "policyRevision",
      "requestId",
      "effect",
      "reasonCode",
      "matchedRuleIds",
      "evaluatedAt",
    ],
    "invalid-policy",
    "Policy decision",
  );
  assertIdentifier(
    value.decisionId,
    policyDecisionId,
    "invalid-policy",
    "Policy decision.decisionId",
  );
  assertIdentifier(
    value.policyRevision,
    policyRevision,
    "invalid-policy",
    "Policy decision.policyRevision",
  );
  assertIdentifier(value.requestId, toolRequestId, "invalid-policy", "Policy decision.requestId");
  assertKnownValue(
    value.effect,
    ["allow", "require-approval", "deny"],
    "invalid-policy",
    "Policy decision.effect",
  );
  assertKnownValue(
    value.reasonCode,
    ["matching-rule-allow", "matching-rule-approval", "matching-rule-deny", "no-matching-rule"],
    "invalid-policy",
    "Policy decision.reasonCode",
  );
  assertUniqueIdentifiers(
    value.matchedRuleIds,
    policyRuleId,
    "invalid-policy",
    "Policy decision.matchedRuleIds",
  );
  assertInstant(value.evaluatedAt, "invalid-policy", "Policy decision.evaluatedAt");

  const expectedReason: PolicyDecisionReason =
    value.matchedRuleIds.length === 0
      ? "no-matching-rule"
      : value.effect === "deny"
        ? "matching-rule-deny"
        : value.effect === "require-approval"
          ? "matching-rule-approval"
          : "matching-rule-allow";
  if (
    value.reasonCode !== expectedReason ||
    (value.matchedRuleIds.length === 0 && value.effect !== "deny")
  ) {
    throw new PrivilegedServiceError(
      "invalid-policy",
      "Policy decision effect, reason, and matching rules are inconsistent",
    );
  }
}

export function assertToolCapabilityManifest(
  value: unknown,
): asserts value is ToolCapabilityManifest {
  assertRecord(value, "invalid-manifest", "Tool capability manifest");
  assertExactKeys(
    value,
    ["contractVersion", "toolId", "actions", "resourceKinds", "credentialUse", "timeoutMs"],
    "invalid-manifest",
    "Tool capability manifest",
  );
  assertContractVersion(value.contractVersion, "invalid-manifest", "Tool capability manifest");
  assertIdentifier(value.toolId, toolId, "invalid-manifest", "Tool capability manifest.toolId");
  assertUniqueKnownValues(
    value.actions,
    PROTECTED_ACTIONS,
    "invalid-manifest",
    "Tool capability manifest.actions",
  );
  assertUniqueKnownValues(
    value.resourceKinds,
    PROTECTED_RESOURCE_KINDS,
    "invalid-manifest",
    "Tool capability manifest.resourceKinds",
  );
  assertKnownValue(
    value.credentialUse,
    ["forbidden", "optional", "required"],
    "invalid-manifest",
    "Tool capability manifest.credentialUse",
  );
  if (!Number.isSafeInteger(value.timeoutMs) || (value.timeoutMs as number) < 1) {
    throw new PrivilegedServiceError(
      "invalid-manifest",
      "Tool capability manifest.timeoutMs must be a positive safe integer",
    );
  }
}

export function assertAuthorizationGrant(value: unknown): asserts value is AuthorizationGrant {
  assertRecord(value, "invalid-contract", "Authorization grant");
  assertExactKeys(
    value,
    [
      "grantId",
      "requestId",
      "workspaceId",
      "taskId",
      "sessionId",
      "workerId",
      "toolId",
      "inputRef",
      "action",
      "resourceKind",
      "credentialRefs",
      "policyDecisionId",
      "policyRevision",
      "method",
      "approvalId",
      "issuedAt",
    ],
    "invalid-contract",
    "Authorization grant",
  );
  assertIdentifier(
    value.grantId,
    authorizationGrantId,
    "invalid-contract",
    "Authorization grant.grantId",
  );
  assertIdentifier(
    value.requestId,
    toolRequestId,
    "invalid-contract",
    "Authorization grant.requestId",
  );
  assertIdentifier(
    value.workspaceId,
    workspaceId,
    "invalid-contract",
    "Authorization grant.workspaceId",
  );
  assertIdentifier(value.taskId, taskId, "invalid-contract", "Authorization grant.taskId");
  assertIdentifier(value.sessionId, sessionId, "invalid-contract", "Authorization grant.sessionId");
  assertIdentifier(value.workerId, workerId, "invalid-contract", "Authorization grant.workerId");
  assertIdentifier(value.toolId, toolId, "invalid-contract", "Authorization grant.toolId");
  assertIdentifier(
    value.inputRef,
    toolInputReference,
    "invalid-contract",
    "Authorization grant.inputRef",
  );
  assertKnownValue(
    value.action,
    PROTECTED_ACTIONS,
    "invalid-contract",
    "Authorization grant.action",
  );
  assertKnownValue(
    value.resourceKind,
    PROTECTED_RESOURCE_KINDS,
    "invalid-contract",
    "Authorization grant.resourceKind",
  );
  assertUniqueIdentifiers(
    value.credentialRefs,
    credentialReference,
    "invalid-contract",
    "Authorization grant.credentialRefs",
  );
  assertIdentifier(
    value.policyDecisionId,
    policyDecisionId,
    "invalid-contract",
    "Authorization grant.policyDecisionId",
  );
  assertIdentifier(
    value.policyRevision,
    policyRevision,
    "invalid-contract",
    "Authorization grant.policyRevision",
  );
  assertKnownValue(
    value.method,
    ["policy", "approval"],
    "invalid-contract",
    "Authorization grant.method",
  );
  if (value.approvalId !== undefined) {
    assertIdentifier(
      value.approvalId,
      approvalId,
      "invalid-contract",
      "Authorization grant.approvalId",
    );
  }
  if ((value.method === "approval") !== (value.approvalId !== undefined)) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval authorization grants must contain exactly one approval reference",
    );
  }
  assertInstant(value.issuedAt, "invalid-contract", "Authorization grant.issuedAt");
}

export function assertApprovalRequestSnapshot(
  value: unknown,
): asserts value is ApprovalRequestSnapshot {
  assertRecord(value, "invalid-contract", "Approval request snapshot");
  assertExactKeys(
    value,
    [
      "approvalId",
      "operation",
      "policyRevision",
      "state",
      "requestedAt",
      "expiresAt",
      "resolvedAt",
      "resolvedBy",
      "consumedAt",
    ],
    "invalid-contract",
    "Approval request snapshot",
  );
  assertIdentifier(
    value.approvalId,
    approvalId,
    "invalid-contract",
    "Approval request snapshot.approvalId",
  );
  assertProtectedOperation(value.operation);
  assertIdentifier(
    value.policyRevision,
    policyRevision,
    "invalid-contract",
    "Approval request snapshot.policyRevision",
  );
  assertKnownValue(
    value.state,
    ["pending", "approved", "denied", "expired", "cancelled"],
    "invalid-contract",
    "Approval request snapshot.state",
  );
  assertInstant(value.requestedAt, "invalid-contract", "Approval request snapshot.requestedAt");
  assertInstant(value.expiresAt, "invalid-contract", "Approval request snapshot.expiresAt");

  if (
    compareInstants(value.requestedAt, value.operation.requestedAt) < 0 ||
    compareInstants(value.expiresAt, value.requestedAt) <= 0
  ) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval request timestamps do not follow the protected operation",
    );
  }

  if (value.resolvedAt !== undefined) {
    assertInstant(value.resolvedAt, "invalid-contract", "Approval request snapshot.resolvedAt");
  }
  if (value.resolvedBy !== undefined) {
    assertIdentifier(
      value.resolvedBy,
      approvalActorId,
      "invalid-contract",
      "Approval request snapshot.resolvedBy",
    );
  }
  if (value.consumedAt !== undefined) {
    assertInstant(value.consumedAt, "invalid-contract", "Approval request snapshot.consumedAt");
  }
  // Keep the validated optional instants narrowed under both Actestra's strict
  // TypeScript config and the preserved downstream noImplicitAny-only config.
  const resolvedAt = value.resolvedAt as Instant | undefined;
  const consumedAt = value.consumedAt as Instant | undefined;

  const terminal = value.state !== "pending";
  if (
    terminal !== (value.resolvedAt !== undefined) ||
    (value.state === "expired") !== (terminal && value.resolvedBy === undefined) ||
    (terminal && value.state !== "expired" && value.resolvedBy === undefined) ||
    (!terminal && (value.resolvedBy !== undefined || value.consumedAt !== undefined))
  ) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval request terminal state, timestamp, and actor are inconsistent",
    );
  }
  if (
    resolvedAt !== undefined &&
    (compareInstants(resolvedAt, value.requestedAt) < 0 ||
      (value.state === "expired"
        ? compareInstants(resolvedAt, value.expiresAt) < 0
        : compareInstants(resolvedAt, value.expiresAt) >= 0))
  ) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval resolution must occur before expiry",
    );
  }
  if (
    consumedAt !== undefined &&
    (value.state !== "approved" ||
      resolvedAt === undefined ||
      compareInstants(consumedAt, resolvedAt) < 0 ||
      compareInstants(consumedAt, value.expiresAt) >= 0)
  ) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval consumption must follow approval and precede expiry",
    );
  }
}

export function assertAuthorizationResult(value: unknown): asserts value is AuthorizationResult {
  assertRecord(value, "invalid-contract", "Authorization result");
  if (value.status === "approval-required") {
    assertExactKeys(
      value,
      ["status", "approval"],
      "invalid-contract",
      "Approval-required authorization result",
    );
    assertApprovalRequestSnapshot(value.approval);
    return;
  }
  if (value.status === "granted") {
    assertExactKeys(
      value,
      ["status", "authorization"],
      "invalid-contract",
      "Granted authorization result",
    );
    assertAuthorizationGrant(value.authorization);
    return;
  }
  throw new PrivilegedServiceError(
    "invalid-contract",
    "Authorization result.status is unsupported",
  );
}

export function assertCredentialLease(value: unknown): asserts value is CredentialLease {
  assertRecord(value, "invalid-contract", "Credential lease");
  assertExactKeys(
    value,
    ["leaseId", "credentialRef", "requestId", "authorizationGrantId", "issuedAt", "expiresAt"],
    "invalid-contract",
    "Credential lease",
  );
  assertIdentifier(
    value.leaseId,
    credentialLeaseId,
    "invalid-contract",
    "Credential lease.leaseId",
  );
  assertIdentifier(
    value.credentialRef,
    credentialReference,
    "invalid-contract",
    "Credential lease.credentialRef",
  );
  assertIdentifier(
    value.requestId,
    toolRequestId,
    "invalid-contract",
    "Credential lease.requestId",
  );
  assertIdentifier(
    value.authorizationGrantId,
    authorizationGrantId,
    "invalid-contract",
    "Credential lease.authorizationGrantId",
  );
  assertInstant(value.issuedAt, "invalid-contract", "Credential lease.issuedAt");
  assertInstant(value.expiresAt, "invalid-contract", "Credential lease.expiresAt");
  if (compareInstants(value.expiresAt, value.issuedAt) <= 0) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Credential lease must expire after it is issued",
    );
  }
}

export function authorizationMatchesOperation(
  authorization: AuthorizationGrant,
  operation: ProtectedOperation,
): boolean {
  assertAuthorizationGrant(authorization);
  assertProtectedOperation(operation);

  return (
    authorization.requestId === operation.requestId &&
    authorization.workspaceId === operation.workspaceId &&
    authorization.taskId === operation.taskId &&
    authorization.sessionId === operation.sessionId &&
    authorization.workerId === operation.workerId &&
    authorization.toolId === operation.toolId &&
    authorization.inputRef === operation.inputRef &&
    authorization.action === operation.action &&
    authorization.resourceKind === operation.resourceKind &&
    authorization.credentialRefs.length === operation.credentialRefs.length &&
    authorization.credentialRefs.every(
      (reference, index) => reference === operation.credentialRefs[index],
    )
  );
}

export function protectedOperationsEqual(
  left: ProtectedOperation,
  right: ProtectedOperation,
): boolean {
  assertProtectedOperation(left);
  assertProtectedOperation(right);

  return (
    left.contractVersion === right.contractVersion &&
    left.requestId === right.requestId &&
    left.workspaceId === right.workspaceId &&
    left.taskId === right.taskId &&
    left.sessionId === right.sessionId &&
    left.workerId === right.workerId &&
    left.toolId === right.toolId &&
    left.inputRef === right.inputRef &&
    left.action === right.action &&
    left.resourceKind === right.resourceKind &&
    left.summary === right.summary &&
    left.requestedAt === right.requestedAt &&
    left.credentialRefs.length === right.credentialRefs.length &&
    left.credentialRefs.every((reference, index) => reference === right.credentialRefs[index])
  );
}

export function auditContextFor(operation: ProtectedOperation): PrivilegedAuditContext {
  assertProtectedOperation(operation);
  return Object.freeze({
    requestId: operation.requestId,
    workspaceId: operation.workspaceId,
    taskId: operation.taskId,
    sessionId: operation.sessionId,
    workerId: operation.workerId,
    toolId: operation.toolId,
    action: operation.action,
    resourceKind: operation.resourceKind,
  });
}

function assertAuditContext(value: unknown): asserts value is PrivilegedAuditContext {
  assertRecord(value, "invalid-audit", "Audit context");
  assertExactKeys(
    value,
    [
      "requestId",
      "workspaceId",
      "taskId",
      "sessionId",
      "workerId",
      "toolId",
      "action",
      "resourceKind",
    ],
    "invalid-audit",
    "Audit context",
  );
  assertIdentifier(value.requestId, toolRequestId, "invalid-audit", "Audit context.requestId");
  assertIdentifier(value.workspaceId, workspaceId, "invalid-audit", "Audit context.workspaceId");
  assertIdentifier(value.taskId, taskId, "invalid-audit", "Audit context.taskId");
  assertIdentifier(value.sessionId, sessionId, "invalid-audit", "Audit context.sessionId");
  assertIdentifier(value.workerId, workerId, "invalid-audit", "Audit context.workerId");
  assertIdentifier(value.toolId, toolId, "invalid-audit", "Audit context.toolId");
  assertKnownValue(value.action, PROTECTED_ACTIONS, "invalid-audit", "Audit context.action");
  assertKnownValue(
    value.resourceKind,
    PROTECTED_RESOURCE_KINDS,
    "invalid-audit",
    "Audit context.resourceKind",
  );
}

function assertSafeErrorCode(value: unknown): void {
  assertText(value, "invalid-audit", "Audit event.errorCode", 128);
  if ((value as string).includes(" ")) {
    throw new PrivilegedServiceError(
      "invalid-audit",
      "Audit event.errorCode must be a stable code without spaces",
    );
  }
}

export function assertAuditEvent(value: unknown): asserts value is AuditEvent {
  assertRecord(value, "invalid-audit", "Audit event");
  assertKnownValue(
    value.type,
    [
      "policy.evaluated",
      "approval.requested",
      "approval.resolved",
      "approval.consumed",
      "credential.lease-issued",
      "credential.lease-released",
      "tool.started",
      "tool.completed",
      "tool.failed",
    ],
    "invalid-audit",
    "Audit event.type",
  );
  assertAuditContext(value.context);

  switch (value.type) {
    case "policy.evaluated":
      assertExactKeys(
        value,
        ["type", "context", "policyRevision", "decision", "reasonCode", "matchedRuleIds"],
        "invalid-audit",
        "Policy audit event",
      );
      assertIdentifier(
        value.policyRevision,
        policyRevision,
        "invalid-audit",
        "Policy audit event.policyRevision",
      );
      assertKnownValue(
        value.decision,
        ["allow", "require-approval", "deny"],
        "invalid-audit",
        "Policy audit event.decision",
      );
      assertKnownValue(
        value.reasonCode,
        ["matching-rule-allow", "matching-rule-approval", "matching-rule-deny", "no-matching-rule"],
        "invalid-audit",
        "Policy audit event.reasonCode",
      );
      assertUniqueIdentifiers(
        value.matchedRuleIds,
        policyRuleId,
        "invalid-audit",
        "Policy audit event.matchedRuleIds",
      );
      return;
    case "approval.requested":
      assertExactKeys(
        value,
        ["type", "context", "approvalId", "policyRevision", "expiresAt"],
        "invalid-audit",
        "Approval request audit event",
      );
      assertIdentifier(
        value.approvalId,
        approvalId,
        "invalid-audit",
        "Approval audit event.approvalId",
      );
      assertIdentifier(
        value.policyRevision,
        policyRevision,
        "invalid-audit",
        "Approval audit event.policyRevision",
      );
      assertInstant(value.expiresAt, "invalid-audit", "Approval audit event.expiresAt");
      return;
    case "approval.resolved":
      assertExactKeys(
        value,
        ["type", "context", "approvalId", "decision", "actorId"],
        "invalid-audit",
        "Approval resolution audit event",
      );
      assertIdentifier(
        value.approvalId,
        approvalId,
        "invalid-audit",
        "Approval audit event.approvalId",
      );
      assertKnownValue(
        value.decision,
        ["approved", "denied", "expired", "cancelled"],
        "invalid-audit",
        "Approval audit event.decision",
      );
      if (value.actorId !== undefined) {
        assertIdentifier(
          value.actorId,
          approvalActorId,
          "invalid-audit",
          "Approval audit event.actorId",
        );
      }
      if ((value.decision === "expired") === (value.actorId !== undefined)) {
        throw new PrivilegedServiceError(
          "invalid-audit",
          "Expired approvals have no actor and user decisions require one actor",
        );
      }
      return;
    case "approval.consumed":
      assertExactKeys(
        value,
        ["type", "context", "approvalId", "grantId"],
        "invalid-audit",
        "Approval consumption audit event",
      );
      assertIdentifier(
        value.approvalId,
        approvalId,
        "invalid-audit",
        "Approval audit event.approvalId",
      );
      assertIdentifier(
        value.grantId,
        authorizationGrantId,
        "invalid-audit",
        "Approval audit event.grantId",
      );
      return;
    case "credential.lease-issued":
      assertExactKeys(
        value,
        ["type", "context", "credentialRef", "leaseId", "grantId", "expiresAt"],
        "invalid-audit",
        "Credential lease audit event",
      );
      assertIdentifier(
        value.credentialRef,
        credentialReference,
        "invalid-audit",
        "Credential audit event.credentialRef",
      );
      assertIdentifier(
        value.leaseId,
        credentialLeaseId,
        "invalid-audit",
        "Credential audit event.leaseId",
      );
      assertIdentifier(
        value.grantId,
        authorizationGrantId,
        "invalid-audit",
        "Credential audit event.grantId",
      );
      assertInstant(value.expiresAt, "invalid-audit", "Credential audit event.expiresAt");
      return;
    case "credential.lease-released":
      assertExactKeys(
        value,
        ["type", "context", "credentialRef", "leaseId", "grantId"],
        "invalid-audit",
        "Credential release audit event",
      );
      assertIdentifier(
        value.credentialRef,
        credentialReference,
        "invalid-audit",
        "Credential audit event.credentialRef",
      );
      assertIdentifier(
        value.leaseId,
        credentialLeaseId,
        "invalid-audit",
        "Credential audit event.leaseId",
      );
      assertIdentifier(
        value.grantId,
        authorizationGrantId,
        "invalid-audit",
        "Credential audit event.grantId",
      );
      return;
    case "tool.started":
      assertExactKeys(
        value,
        ["type", "context", "authorizationMethod", "approvalId"],
        "invalid-audit",
        "Tool start audit event",
      );
      assertKnownValue(
        value.authorizationMethod,
        ["policy", "approval"],
        "invalid-audit",
        "Tool start audit event.authorizationMethod",
      );
      if (value.approvalId !== undefined) {
        assertIdentifier(
          value.approvalId,
          approvalId,
          "invalid-audit",
          "Tool start audit event.approvalId",
        );
      }
      if ((value.authorizationMethod === "approval") !== (value.approvalId !== undefined)) {
        throw new PrivilegedServiceError(
          "invalid-audit",
          "Approval tool starts must contain exactly one approval reference",
        );
      }
      return;
    case "tool.completed":
      assertExactKeys(
        value,
        ["type", "context", "outputRef"],
        "invalid-audit",
        "Tool completion audit event",
      );
      if (value.outputRef !== undefined) {
        assertIdentifier(
          value.outputRef,
          toolOutputReference,
          "invalid-audit",
          "Tool completion audit event.outputRef",
        );
      }
      return;
    case "tool.failed":
      assertExactKeys(
        value,
        ["type", "context", "errorCode"],
        "invalid-audit",
        "Tool failure audit event",
      );
      assertSafeErrorCode(value.errorCode);
  }
}

export function assertAuditRecord(value: unknown): asserts value is AuditRecord {
  assertRecord(value, "invalid-audit", "Audit record");
  assertExactKeys(
    value,
    ["contractVersion", "recordId", "sequence", "occurredAt", "redaction", "event"],
    "invalid-audit",
    "Audit record",
  );
  assertContractVersion(value.contractVersion, "invalid-audit", "Audit record");
  assertIdentifier(value.recordId, auditRecordId, "invalid-audit", "Audit record.recordId");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    throw new PrivilegedServiceError(
      "invalid-audit",
      "Audit record.sequence must be a positive safe integer",
    );
  }
  assertInstant(value.occurredAt, "invalid-audit", "Audit record.occurredAt");
  if (value.redaction !== "metadata") {
    throw new PrivilegedServiceError("invalid-audit", "Audit record.redaction must be metadata");
  }
  assertAuditEvent(value.event);
}

export function assertToolExecutionResult(value: unknown): asserts value is ToolExecutionResult {
  assertRecord(value, "invalid-contract", "Tool execution result");
  assertExactKeys(value, ["status", "outputRef"], "invalid-contract", "Tool execution result");
  if (value.status !== "succeeded") {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Tool execution result.status must be succeeded",
    );
  }
  if (value.outputRef !== undefined) {
    assertIdentifier(
      value.outputRef,
      toolOutputReference,
      "invalid-contract",
      "Tool execution result.outputRef",
    );
  }
}
