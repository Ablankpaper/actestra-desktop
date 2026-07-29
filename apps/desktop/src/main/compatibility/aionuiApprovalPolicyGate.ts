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

const APPROVAL_DELIVERY_TOOL_ID = toolId("aionui-approval-delivery-v1");
const APPROVAL_DELIVERY_POLICY_REVISION = policyRevision("policy-aionui-approval-delivery-v1");
const APPROVAL_DELIVERY_RULE_ID = policyRuleId("allow-aionui-approval-delivery-v1");
const APPROVAL_DELIVERY_TIMEOUT_MS = 12_000;
const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;

interface ActiveDelivery {
  readonly operation: ProtectedOperation;
  readonly record: AionUiApprovalDecisionRecord;
  readonly signal: AbortSignal;
  nativeFailure: unknown;
  nativeFailed: boolean;
}

export interface AionUiApprovalPolicyGateConfig {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compatibilityHash(value: string): string {
  return sha256(value).slice(0, 32);
}

function deliveryOperation(
  record: AionUiApprovalDecisionRecord,
  requestedAt: ReturnType<PrivilegedClock["now"]>,
): ProtectedOperation {
  assertAionUiApprovalDecisionRecord(record);
  instant(requestedAt);
  if (record.deliveryState !== "pending-delivery" || record.attemptCount < 1) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Only an attempted pending AionUi approval response can enter the policy gate",
    );
  }

  const conversationHash = compatibilityHash(record.nativeConversationId);
  const callHash = compatibilityHash(record.nativeCallId);
  const attempt = String(record.attemptCount);
  const operation = Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId: toolRequestId(`aionui-approval-delivery-${record.decisionId.slice(-32)}-${attempt}`),
    workspaceId: workspaceId(`aionui-compat-workspace-${conversationHash}`),
    taskId: taskId(`aionui-compat-task-${callHash}`),
    sessionId: sessionId(`aionui-compat-session-${conversationHash}`),
    workerId: workerId("aionui-compat-aioncore-v0-1-52"),
    toolId: APPROVAL_DELIVERY_TOOL_ID,
    inputRef: toolInputReference(
      `aionui-approval-body-${record.requestHash.slice(0, 32)}-${attempt}`,
    ),
    action: "network.request",
    resourceKind: "external-service",
    summary: "Deliver one persisted AionUi confirmation response to the loopback runtime",
    credentialRefs: Object.freeze([]),
    requestedAt,
  }) satisfies ProtectedOperation;
  assertProtectedOperation(operation);
  return operation;
}

class AionUiApprovalDeliveryExecutor implements ProtectedToolExecutor {
  constructor(
    private readonly transport: AionUiApprovalNativeTransport,
    private readonly activeDeliveries: ReadonlyMap<ToolInputReference, ActiveDelivery>,
  ) {}

  async manifest(requestedTool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(requestedTool);
    if (requestedTool !== APPROVAL_DELIVERY_TOOL_ID) {
      throw new PrivilegedServiceError(
        "manifest-unavailable",
        "The requested protected tool is not the AionUi approval delivery transport",
      );
    }
    return Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      toolId: APPROVAL_DELIVERY_TOOL_ID,
      actions: Object.freeze(["network.request"] as const),
      resourceKinds: Object.freeze(["external-service"] as const),
      credentialUse: "forbidden",
      timeoutMs: APPROVAL_DELIVERY_TIMEOUT_MS,
    }) satisfies ToolCapabilityManifest;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const active = this.activeDeliveries.get(request.operation.inputRef);
    if (
      active === undefined ||
      !protectedOperationsEqual(active.operation, request.operation) ||
      request.authorization.method !== "policy" ||
      request.authorization.approvalId !== undefined ||
      request.credentialLeases.length !== 0 ||
      request.timeoutMs !== APPROVAL_DELIVERY_TIMEOUT_MS
    ) {
      throw new PrivilegedServiceError(
        "tool-execution-failed",
        "The AionUi approval delivery input reference is unavailable or mismatched",
      );
    }

    try {
      await this.transport.deliver(active.record, active.signal);
    } catch (error) {
      active.nativeFailed = true;
      active.nativeFailure = error;
      throw error;
    }
    return Object.freeze({
      status: "succeeded",
    });
  }
}

export class PolicyGatedAionUiApprovalNativeTransport implements AionUiApprovalNativeTransport {
  private readonly clock: PrivilegedClock;
  private readonly gateway: PrivilegedToolGateway;
  private readonly activeDeliveries = new Map<ToolInputReference, ActiveDelivery>();

  constructor(private readonly config: AionUiApprovalPolicyGateConfig) {
    this.clock = config.clock ?? new SystemPrivilegedClock();
    instant(this.clock.now());
    const newIdentifier =
      config.newIdentifier ?? ((prefix: string): string => `${prefix}-${randomUUID()}`);
    const auditTrail = new PersistentAuditTrail({
      clock: this.clock,
      persistence: config.persistence,
      newRecordId: () => auditRecordId(newIdentifier("audit-record")),
    });
    const policy = Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      revision: APPROVAL_DELIVERY_POLICY_REVISION,
      rules: Object.freeze([
        Object.freeze({
          id: APPROVAL_DELIVERY_RULE_ID,
          effect: "allow",
          actions: Object.freeze(["network.request"] as const),
          resourceKinds: Object.freeze(["external-service"] as const),
          credentialUse: "none",
          toolIds: Object.freeze([APPROVAL_DELIVERY_TOOL_ID]),
        }),
      ]),
    }) satisfies PolicySnapshot;
    const policyEngine = new DeterministicPolicyEngine(policy, this.clock, () =>
      policyDecisionId(newIdentifier("policy-decision")),
    );
    const approvalService = new InMemoryApprovalService({
      clock: this.clock,
      auditTrail,
      ttlMs: APPROVAL_TTL_MS,
      newApprovalId: () => approvalId(newIdentifier("approval")),
      newGrantId: () => authorizationGrantId(newIdentifier("authorization-grant")),
    });
    const credentialBroker = new ReferenceCredentialBroker({
      clock: this.clock,
      auditTrail,
      leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
      historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
      newLeaseId: () => credentialLeaseId(newIdentifier("credential-lease")),
    });
    this.gateway = new PrivilegedToolGateway({
      policyEngine,
      approvalService,
      credentialBroker,
      auditTrail,
      executor: new AionUiApprovalDeliveryExecutor(config.transport, this.activeDeliveries),
    });
  }

  async isPending(record: AionUiApprovalDecisionRecord, signal: AbortSignal): Promise<boolean> {
    assertAionUiApprovalDecisionRecord(record);
    return this.config.transport.isPending(record, signal);
  }

  async deliver(record: AionUiApprovalDecisionRecord, signal: AbortSignal): Promise<void> {
    const operation = deliveryOperation(record, this.clock.now());
    const inputRef = operation.inputRef;
    if (this.activeDeliveries.has(inputRef)) {
      throw new PrivilegedServiceError(
        "tool-execution-failed",
        "The AionUi approval delivery attempt is already active",
      );
    }
    const active: ActiveDelivery = {
      operation,
      record,
      signal,
      nativeFailure: undefined,
      nativeFailed: false,
    };
    this.activeDeliveries.set(inputRef, active);
    try {
      const result = await this.gateway.invoke(operation);
      if (result.status !== "executed") {
        throw new PrivilegedServiceError(
          "approval-not-granted",
          "The AionUi approval delivery policy unexpectedly requested another approval",
        );
      }
    } catch (error) {
      if (
        active.nativeFailed &&
        error instanceof PrivilegedServiceError &&
        error.code === "tool-execution-failed"
      ) {
        throw active.nativeFailure;
      }
      throw error;
    } finally {
      if (this.activeDeliveries.get(inputRef) === active) {
        this.activeDeliveries.delete(inputRef);
      }
    }
  }
}

export function createPolicyGatedAionUiApprovalNativeTransport(
  config: AionUiApprovalPolicyGateConfig,
): AionUiApprovalNativeTransport {
  return new PolicyGatedAionUiApprovalNativeTransport(config);
}
