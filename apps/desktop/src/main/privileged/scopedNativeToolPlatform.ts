import { randomUUID } from "node:crypto";
import {
  PRIVILEGED_CONTRACT_VERSION,
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  toolOutputReference,
  type ActestraPersistencePort,
  type AgentClock,
  type ApprovalService,
  type AuditRecordId,
  type AuditTrail,
  type AuthorizationGrantId,
  type CredentialBroker,
  type CredentialLeaseId,
  type PolicyDecisionId,
  type PolicyEngine,
  type PolicyRule,
  type PolicySnapshot,
  type PrivilegedClock,
  type ToolGateway,
  type ToolOutputReference,
} from "../../core";
import { AgentAdapterSupervisor } from "../workers/agentAdapterSupervisor";
import { ScopedNativeToolCoordinator } from "../workers/scopedNativeToolCoordinator";
import { DeterministicPolicyEngine } from "./deterministicPolicyEngine";
import { InMemoryApprovalService } from "./inMemoryApprovalService";
import { PersistentAuditTrail } from "./persistentAuditTrail";
import { ReferenceCredentialBroker } from "./referenceCredentialBroker";
import { ScopedNativeTextToolExecutor } from "./scopedNativeTextToolExecutor";
import { PrivilegedToolGateway } from "./toolGateway";

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;

export const SCOPED_NATIVE_POLICY_REVISION = policyRevision("policy-p4-scoped-native-tools-v2");

export interface ScopedNativeToolPlatformIdSources {
  readonly newAuditRecordId: () => AuditRecordId;
  readonly newPolicyDecisionId: () => PolicyDecisionId;
  readonly newApprovalId: () => ReturnType<typeof approvalId>;
  readonly newAuthorizationGrantId: () => AuthorizationGrantId;
  readonly newCredentialLeaseId: () => CredentialLeaseId;
  readonly newOutputReference: () => ToolOutputReference;
}

export interface ScopedNativeToolPlatformConfig {
  readonly persistence: ActestraPersistencePort;
  readonly clock?: AgentClock & PrivilegedClock;
  readonly identifiers?: ScopedNativeToolPlatformIdSources;
}

class SystemScopedNativeToolClock implements AgentClock, PrivilegedClock {
  now() {
    return instant(new Date().toISOString());
  }
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function defaultIdentifiers(): ScopedNativeToolPlatformIdSources {
  return {
    newAuditRecordId: () => auditRecordId(identifier("audit-record")),
    newPolicyDecisionId: () => policyDecisionId(identifier("policy-decision")),
    newApprovalId: () => approvalId(identifier("approval")),
    newAuthorizationGrantId: () => authorizationGrantId(identifier("authorization-grant")),
    newCredentialLeaseId: () => credentialLeaseId(identifier("credential-lease")),
    newOutputReference: () => toolOutputReference(identifier("tool-output")),
  };
}

export function scopedNativePolicySnapshot(): PolicySnapshot {
  const rules = Object.freeze([
    Object.freeze({
      id: policyRuleId("rule-gw-p4-4-workspace-read-text"),
      effect: "allow",
      actions: Object.freeze(["workspace.read"]),
      resourceKinds: Object.freeze(["workspace"]),
      credentialUse: "none",
      toolIds: Object.freeze([WORKSPACE_READ_TEXT_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-gw-p4-4-task-output-write-text"),
      effect: "allow",
      actions: Object.freeze(["artifact.create"]),
      resourceKinds: Object.freeze(["task-output"]),
      credentialUse: "none",
      toolIds: Object.freeze([TASK_OUTPUT_WRITE_TEXT_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p4-office-document-output"),
      effect: "allow",
      actions: Object.freeze(["artifact.create"]),
      resourceKinds: Object.freeze(["task-output"]),
      credentialUse: "none",
      toolIds: Object.freeze([TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID]),
    } satisfies PolicyRule),
  ]);
  return Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    revision: SCOPED_NATIVE_POLICY_REVISION,
    rules,
  } satisfies PolicySnapshot);
}

export class ScopedNativeToolPlatform {
  readonly auditTrail: AuditTrail;
  readonly policyEngine: PolicyEngine;
  readonly approvalService: ApprovalService;
  readonly credentialBroker: CredentialBroker;
  readonly executor: ScopedNativeTextToolExecutor;
  readonly toolGateway: ToolGateway;
  readonly clock: AgentClock & PrivilegedClock;
  private readonly coordinators = new WeakMap<
    AgentAdapterSupervisor,
    ScopedNativeToolCoordinator
  >();

  constructor(config: ScopedNativeToolPlatformConfig) {
    this.clock = config.clock ?? new SystemScopedNativeToolClock();
    const identifiers = config.identifiers ?? defaultIdentifiers();
    this.auditTrail = new PersistentAuditTrail({
      clock: this.clock,
      persistence: config.persistence,
      newRecordId: identifiers.newAuditRecordId,
    });
    this.policyEngine = new DeterministicPolicyEngine(
      scopedNativePolicySnapshot(),
      this.clock,
      identifiers.newPolicyDecisionId,
    );
    this.approvalService = new InMemoryApprovalService({
      clock: this.clock,
      auditTrail: this.auditTrail,
      ttlMs: APPROVAL_TTL_MS,
      newApprovalId: identifiers.newApprovalId,
      newGrantId: identifiers.newAuthorizationGrantId,
    });
    this.credentialBroker = new ReferenceCredentialBroker({
      clock: this.clock,
      auditTrail: this.auditTrail,
      leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
      historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
      newLeaseId: identifiers.newCredentialLeaseId,
    });
    this.executor = new ScopedNativeTextToolExecutor({
      persistence: config.persistence,
      clock: this.clock,
      newOutputReference: identifiers.newOutputReference,
    });
    this.toolGateway = new PrivilegedToolGateway({
      policyEngine: this.policyEngine,
      approvalService: this.approvalService,
      credentialBroker: this.credentialBroker,
      auditTrail: this.auditTrail,
      executor: this.executor,
    });
  }

  createCoordinator(supervisor: AgentAdapterSupervisor): ScopedNativeToolCoordinator {
    const existing = this.coordinators.get(supervisor);
    if (existing !== undefined) {
      return existing;
    }
    const coordinator = new ScopedNativeToolCoordinator(supervisor, this.toolGateway, this.clock);
    this.coordinators.set(supervisor, coordinator);
    return coordinator;
  }
}

export function createScopedNativeToolPlatform(
  config: ScopedNativeToolPlatformConfig,
): ScopedNativeToolPlatform {
  return new ScopedNativeToolPlatform(config);
}
