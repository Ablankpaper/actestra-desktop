import { createHash, randomUUID } from "node:crypto";
import {
  PRIVILEGED_CONTRACT_VERSION,
  PrivilegedServiceError,
  approvalId,
  assertProtectedOperation,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  protectedOperationsEqual,
  sessionId,
  taskId,
  toolId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceId,
  type PlatformEvidencePersistencePort,
  type PolicySnapshot,
  type PrivilegedClock,
  type ProtectedOperation,
  type ProtectedToolExecutor,
  type ToolCapabilityManifest,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolId,
  type ToolInputReference,
} from "../../core";
import {
  assertAionUiApprovalDecisionRecord,
  type AionUiApprovalDecisionRecord,
} from "../../compatibility/aionui";
import { DeterministicPolicyEngine } from "../privileged/deterministicPolicyEngine";
import { InMemoryApprovalService } from "../privileged/inMemoryApprovalService";
import { PersistentAuditTrail } from "../privileged/persistentAuditTrail";
import { ReferenceCredentialBroker } from "../privileged/referenceCredentialBroker";
import { PrivilegedToolGateway } from "../privileged/toolGateway";
import type { AionUiApprovalNativeTransport } from "./aionuiApprovalAuthorityService";

const APPROVAL_RECONCILIATION_TOOL_ID = toolId("aionui-approval-reconciliation-read-v1");
const APPROVAL_RECONCILIATION_POLICY_REVISION = policyRevision(
  "policy-aionui-approval-reconciliation-read-v1",
);
const APPROVAL_RECONCILIATION_RULE_ID = policyRuleId(
  "allow-aionui-approval-reconciliation-read-v1",
);
const APPROVAL_RECONCILIATION_TIMEOUT_MS = 12_000;
const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;

interface ActiveReconciliationRead {
  readonly operation: ProtectedOperation;
  readonly record: AionUiApprovalDecisionRecord;
  readonly signal: AbortSignal;
  completed: boolean;
  pending: boolean | undefined;
}

export interface AionUiApprovalReconciliationPolicyGateConfig {
  readonly persistence: PlatformEvidencePersistencePort;
  readonly transport: AionUiApprovalNativeTransport;
  readonly clock?: PrivilegedClock;
  readonly newIdentifier?: (prefix: string) => string;
}

class SystemPrivilegedClock implements PrivilegedClock {
  now() {
    return instant(new Date().toISOString());
  }
}

function compatibilityHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function reconciliationOperation(
  record: AionUiApprovalDecisionRecord,
  requestedAt: ReturnType<PrivilegedClock["now"]>,
  newIdentifier: (prefix: string) => string,
): ProtectedOperation {
  assertAionUiApprovalDecisionRecord(record);
  instant(requestedAt);
  if (record.deliveryState !== "pending-delivery" || record.attemptCount < 1) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Only an attempted pending AionUi approval response can be reconciled",
    );
  }

  const conversationHash = compatibilityHash(record.nativeConversationId);
  const callHash = compatibilityHash(record.nativeCallId);
  const operation = Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId: toolRequestId(newIdentifier("aionui-approval-reconciliation-request")),
    workspaceId: workspaceId(`aionui-compat-workspace-${conversationHash}`),
    taskId: taskId(`aionui-compat-task-${callHash}`),
    sessionId: sessionId(`aionui-compat-session-${conversationHash}`),
    workerId: workerId("aionui-compat-aioncore-v0-1-52"),
    toolId: APPROVAL_RECONCILIATION_TOOL_ID,
    inputRef: toolInputReference(`aionui-approval-reconciliation-${conversationHash}-${callHash}`),
    action: "network.request",
    resourceKind: "external-service",
    summary: "Check one persisted AionUi confirmation in the loopback runtime",
    credentialRefs: Object.freeze([]),
    requestedAt,
  }) satisfies ProtectedOperation;
  assertProtectedOperation(operation);
  return operation;
}

class AionUiApprovalReconciliationExecutor implements ProtectedToolExecutor {
  constructor(
    private readonly transport: AionUiApprovalNativeTransport,
    private readonly activeReads: ReadonlyMap<ToolInputReference, ActiveReconciliationRead>,
  ) {}

  async manifest(requestedTool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(requestedTool);
    if (requestedTool !== APPROVAL_RECONCILIATION_TOOL_ID) {
      throw new PrivilegedServiceError(
        "manifest-unavailable",
        "The requested protected tool is not the AionUi approval reconciliation reader",
      );
    }
    return Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      toolId: APPROVAL_RECONCILIATION_TOOL_ID,
      actions: Object.freeze(["network.request"] as const),
      resourceKinds: Object.freeze(["external-service"] as const),
      credentialUse: "forbidden",
      timeoutMs: APPROVAL_RECONCILIATION_TIMEOUT_MS,
    }) satisfies ToolCapabilityManifest;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const active = this.activeReads.get(request.operation.inputRef);
    if (
      active === undefined ||
      !protectedOperationsEqual(active.operation, request.operation) ||
      request.authorization.method !== "policy" ||
      request.authorization.approvalId !== undefined ||
      request.credentialLeases.length !== 0 ||
      request.timeoutMs !== APPROVAL_RECONCILIATION_TIMEOUT_MS
    ) {
      throw new PrivilegedServiceError(
        "tool-execution-failed",
        "The AionUi approval reconciliation input reference is unavailable or mismatched",
      );
    }

    const pending = await this.transport.isPending(active.record, active.signal);
    if (typeof pending !== "boolean") {
      throw new PrivilegedServiceError(
        "tool-execution-failed",
        "The AionUi approval reconciliation reader returned an invalid result",
      );
    }
    active.pending = pending;
    active.completed = true;
    return Object.freeze({
      status: "succeeded",
    });
  }
}

export class PolicyGatedAionUiApprovalReconciliationTransport implements AionUiApprovalNativeTransport {
  private readonly clock: PrivilegedClock;
  private readonly newIdentifier: (prefix: string) => string;
  private readonly gateway: PrivilegedToolGateway;
  private readonly activeReads = new Map<ToolInputReference, ActiveReconciliationRead>();
  private readonly inFlightReads = new Map<ToolInputReference, Promise<boolean>>();

  constructor(private readonly config: AionUiApprovalReconciliationPolicyGateConfig) {
    this.clock = config.clock ?? new SystemPrivilegedClock();
    instant(this.clock.now());
    this.newIdentifier =
      config.newIdentifier ?? ((prefix: string): string => `${prefix}-${randomUUID()}`);
    const auditTrail = new PersistentAuditTrail({
      clock: this.clock,
      persistence: config.persistence,
      newRecordId: () => auditRecordId(this.newIdentifier("audit-record")),
    });
    const policy = Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      revision: APPROVAL_RECONCILIATION_POLICY_REVISION,
      rules: Object.freeze([
        Object.freeze({
          id: APPROVAL_RECONCILIATION_RULE_ID,
          effect: "allow",
          actions: Object.freeze(["network.request"] as const),
          resourceKinds: Object.freeze(["external-service"] as const),
          credentialUse: "none",
          toolIds: Object.freeze([APPROVAL_RECONCILIATION_TOOL_ID]),
        }),
      ]),
    }) satisfies PolicySnapshot;
    const policyEngine = new DeterministicPolicyEngine(policy, this.clock, () =>
      policyDecisionId(this.newIdentifier("policy-decision")),
    );
    const approvalService = new InMemoryApprovalService({
      clock: this.clock,
      auditTrail,
      ttlMs: APPROVAL_TTL_MS,
      newApprovalId: () => approvalId(this.newIdentifier("approval")),
      newGrantId: () => authorizationGrantId(this.newIdentifier("authorization-grant")),
    });
    const credentialBroker = new ReferenceCredentialBroker({
      clock: this.clock,
      auditTrail,
      leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
      historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
      newLeaseId: () => credentialLeaseId(this.newIdentifier("credential-lease")),
    });
    this.gateway = new PrivilegedToolGateway({
      policyEngine,
      approvalService,
      credentialBroker,
      auditTrail,
      executor: new AionUiApprovalReconciliationExecutor(config.transport, this.activeReads),
    });
  }

  private async invokePendingRead(
    operation: ProtectedOperation,
    record: AionUiApprovalDecisionRecord,
    signal: AbortSignal,
  ): Promise<boolean> {
    const inputRef = operation.inputRef;
    const active: ActiveReconciliationRead = {
      operation,
      record,
      signal,
      completed: false,
      pending: undefined,
    };
    this.activeReads.set(inputRef, active);
    try {
      const result = await this.gateway.invoke(operation);
      if (result.status !== "executed") {
        throw new PrivilegedServiceError(
          "approval-not-granted",
          "The AionUi approval reconciliation policy unexpectedly requested approval",
        );
      }
      if (!active.completed || typeof active.pending !== "boolean") {
        throw new PrivilegedServiceError(
          "tool-execution-failed",
          "The AionUi approval reconciliation result is unavailable",
        );
      }
      return active.pending;
    } finally {
      if (this.activeReads.get(inputRef) === active) {
        this.activeReads.delete(inputRef);
      }
    }
  }

  async isPending(record: AionUiApprovalDecisionRecord, signal: AbortSignal): Promise<boolean> {
    const operation = reconciliationOperation(record, this.clock.now(), this.newIdentifier);
    const inputRef = operation.inputRef;
    const existing = this.inFlightReads.get(inputRef);
    if (existing !== undefined) {
      return existing;
    }

    const inFlight = this.invokePendingRead(operation, record, signal);
    this.inFlightReads.set(inputRef, inFlight);
    try {
      return await inFlight;
    } finally {
      if (this.inFlightReads.get(inputRef) === inFlight) {
        this.inFlightReads.delete(inputRef);
      }
    }
  }

  async deliver(record: AionUiApprovalDecisionRecord, signal: AbortSignal): Promise<void> {
    return this.config.transport.deliver(record, signal);
  }
}

export function createPolicyGatedAionUiApprovalReconciliationTransport(
  config: AionUiApprovalReconciliationPolicyGateConfig,
): AionUiApprovalNativeTransport {
  return new PolicyGatedAionUiApprovalReconciliationTransport(config);
}
