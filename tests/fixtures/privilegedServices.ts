import {
  PRIVILEGED_CONTRACT_VERSION,
  approvalActorId,
  approvalId,
  authorizationGrantId,
  credentialLeaseId,
  credentialReference,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  sessionId,
  taskId,
  toolId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceId,
  type ApprovalRequestSnapshot,
  type AuthorizationGrant,
  type CredentialLease,
  type PolicyDecision,
  type PolicyRule,
  type PolicySnapshot,
  type ProtectedOperation,
  type ToolCapabilityManifest,
} from "../../apps/desktop/src/core";

export const PRIVILEGED_TIME = instant("2026-07-28T08:00:00.000Z");
export const PRIVILEGED_WORKSPACE_ID = workspaceId("workspace-privileged");
export const PRIVILEGED_TASK_ID = taskId("task-privileged");
export const PRIVILEGED_SESSION_ID = sessionId("session-privileged");
export const PRIVILEGED_WORKER_ID = workerId("worker-privileged");
export const PRIVILEGED_REQUEST_ID = toolRequestId("tool-request-privileged");
export const PRIVILEGED_TOOL_ID = toolId("tool-workspace-read");
export const PRIVILEGED_INPUT_REFERENCE = toolInputReference("tool-input-privileged");
export const PRIVILEGED_APPROVAL_ID = approvalId("approval-privileged");
export const PRIVILEGED_ACTOR_ID = approvalActorId("local-user");

export function createProtectedOperation(
  overrides: Partial<ProtectedOperation> = {},
): ProtectedOperation {
  return {
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId: PRIVILEGED_REQUEST_ID,
    workspaceId: PRIVILEGED_WORKSPACE_ID,
    taskId: PRIVILEGED_TASK_ID,
    sessionId: PRIVILEGED_SESSION_ID,
    workerId: PRIVILEGED_WORKER_ID,
    toolId: PRIVILEGED_TOOL_ID,
    inputRef: PRIVILEGED_INPUT_REFERENCE,
    action: "workspace.read",
    resourceKind: "workspace",
    summary: "Read files inside the approved workspace",
    credentialRefs: [],
    requestedAt: PRIVILEGED_TIME,
    ...overrides,
  };
}

export function createPolicyRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: policyRuleId("rule-workspace-read"),
    effect: "allow",
    actions: ["workspace.read"],
    resourceKinds: ["workspace"],
    credentialUse: "none",
    ...overrides,
  };
}

export function createPolicySnapshot(
  rules: readonly PolicyRule[] = [createPolicyRule()],
): PolicySnapshot {
  return {
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    revision: policyRevision("policy-test-v1"),
    rules,
  };
}

export function createToolManifest(
  overrides: Partial<ToolCapabilityManifest> = {},
): ToolCapabilityManifest {
  return {
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    toolId: PRIVILEGED_TOOL_ID,
    actions: ["workspace.read"],
    resourceKinds: ["workspace"],
    credentialUse: "forbidden",
    timeoutMs: 5_000,
    ...overrides,
  };
}

export const PRIVILEGED_CREDENTIAL_REFERENCE = credentialReference(
  "credential-reference-privileged",
);

export function createPolicyDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    decisionId: policyDecisionId("policy-decision-privileged"),
    policyRevision: createPolicySnapshot().revision,
    requestId: PRIVILEGED_REQUEST_ID,
    effect: "allow",
    reasonCode: "matching-rule-allow",
    matchedRuleIds: [policyRuleId("rule-workspace-read")],
    evaluatedAt: PRIVILEGED_TIME,
    ...overrides,
  };
}

export function createApprovalSnapshot(
  overrides: Partial<ApprovalRequestSnapshot> = {},
): ApprovalRequestSnapshot {
  return {
    approvalId: PRIVILEGED_APPROVAL_ID,
    operation: createProtectedOperation(),
    policyRevision: createPolicySnapshot().revision,
    state: "pending",
    requestedAt: instant("2026-07-28T08:00:01.000Z"),
    expiresAt: instant("2026-07-28T08:01:01.000Z"),
    ...overrides,
  };
}

export function createAuthorizationGrant(
  overrides: Partial<AuthorizationGrant> = {},
): AuthorizationGrant {
  const operation = createProtectedOperation();
  return {
    grantId: authorizationGrantId("authorization-grant-privileged"),
    requestId: operation.requestId,
    workspaceId: operation.workspaceId,
    taskId: operation.taskId,
    sessionId: operation.sessionId,
    workerId: operation.workerId,
    toolId: operation.toolId,
    inputRef: operation.inputRef,
    action: operation.action,
    resourceKind: operation.resourceKind,
    credentialRefs: operation.credentialRefs,
    policyDecisionId: createPolicyDecision().decisionId,
    policyRevision: createPolicySnapshot().revision,
    method: "policy",
    issuedAt: instant("2026-07-28T08:00:03.000Z"),
    ...overrides,
  };
}

export function createCredentialLease(overrides: Partial<CredentialLease> = {}): CredentialLease {
  return {
    leaseId: credentialLeaseId("credential-lease-privileged"),
    credentialRef: PRIVILEGED_CREDENTIAL_REFERENCE,
    requestId: PRIVILEGED_REQUEST_ID,
    authorizationGrantId: createAuthorizationGrant().grantId,
    issuedAt: instant("2026-07-28T08:00:03.000Z"),
    expiresAt: instant("2026-07-28T08:00:04.000Z"),
    ...overrides,
  };
}
