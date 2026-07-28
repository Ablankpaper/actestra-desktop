import { isDeepStrictEqual } from "node:util";
import {
  PrivilegedServiceError,
  approvalActorId,
  approvalId,
  assertApprovalRequestSnapshot,
  assertAuditRecord,
  assertAuthorizationGrant,
  assertPolicyDecision,
  assertProtectedOperation,
  auditContextFor,
  authorizationGrantId,
  compareInstants,
  instant,
  protectedOperationsEqual,
  type ApprovalActorId,
  type ApprovalId,
  type ApprovalRequestSnapshot,
  type ApprovalService,
  type ApprovalState,
  type AuditTrail,
  type AuthorizationGrant,
  type AuthorizationGrantId,
  type AuthorizationResult,
  type PolicyDecision,
  type PrivilegedClock,
  type ProtectedOperation,
  type ToolRequestId,
  type UserApprovalDecision,
} from "../../core";

interface StoredApproval {
  readonly approvalId: ApprovalId;
  readonly operation: ProtectedOperation;
  readonly policyRevision: PolicyDecision["policyRevision"];
  state: ApprovalState;
  readonly requestedAt: ApprovalRequestSnapshot["requestedAt"];
  readonly expiresAt: ApprovalRequestSnapshot["expiresAt"];
  resolvedAt?: ApprovalRequestSnapshot["resolvedAt"];
  resolvedBy?: ApprovalRequestSnapshot["resolvedBy"];
  consumedAt?: ApprovalRequestSnapshot["consumedAt"];
  consumptionPending?: boolean;
}

export interface InMemoryApprovalServiceConfig {
  readonly clock: PrivilegedClock;
  readonly auditTrail: AuditTrail;
  readonly ttlMs: number;
  readonly newApprovalId: () => ApprovalId;
  readonly newGrantId: () => AuthorizationGrantId;
}

function immutableOperation(operation: ProtectedOperation): ProtectedOperation {
  return Object.freeze({
    ...operation,
    credentialRefs: Object.freeze([...operation.credentialRefs]),
  });
}

function snapshot(record: StoredApproval): ApprovalRequestSnapshot {
  const value = Object.freeze({
    approvalId: record.approvalId,
    operation: record.operation,
    policyRevision: record.policyRevision,
    state: record.state,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt }),
    ...(record.resolvedBy === undefined ? {} : { resolvedBy: record.resolvedBy }),
    ...(record.consumedAt === undefined ? {} : { consumedAt: record.consumedAt }),
  }) satisfies ApprovalRequestSnapshot;
  assertApprovalRequestSnapshot(value);
  return value;
}

function immutableDecision(decision: PolicyDecision): PolicyDecision {
  return Object.freeze({
    ...decision,
    matchedRuleIds: Object.freeze([...decision.matchedRuleIds]),
  });
}

function addDuration(now: ApprovalRequestSnapshot["requestedAt"], milliseconds: number) {
  const value = Date.parse(now) + milliseconds;
  if (!Number.isSafeInteger(value) || value > 8_640_000_000_000_000) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Approval expiry exceeds the supported timestamp range",
    );
  }
  return instant(new Date(value).toISOString());
}

export class InMemoryApprovalService implements ApprovalService {
  private readonly approvals = new Map<ApprovalId, StoredApproval>();
  private readonly approvalByRequest = new Map<ToolRequestId, ApprovalId>();
  private readonly approvalCreations = new Map<ToolRequestId, Promise<ApprovalRequestSnapshot>>();
  private readonly grantIds = new Set<AuthorizationGrantId>();

  constructor(private readonly config: InMemoryApprovalServiceConfig) {
    if (!Number.isSafeInteger(config.ttlMs) || config.ttlMs < 1) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Approval ttlMs must be a positive safe integer",
      );
    }
    instant(config.clock.now());
  }

  async authorize(
    operation: ProtectedOperation,
    decision: PolicyDecision,
    approval?: ApprovalId,
  ): Promise<AuthorizationResult> {
    assertProtectedOperation(operation);
    assertPolicyDecision(decision);
    const stableOperation = immutableOperation(operation);
    const stableDecision = immutableDecision(decision);
    if (
      stableDecision.requestId !== stableOperation.requestId ||
      compareInstants(stableDecision.evaluatedAt, this.now()) > 0
    ) {
      throw new PrivilegedServiceError(
        "approval-mismatch",
        "Policy decision does not match the protected operation",
      );
    }

    if (stableDecision.effect === "deny") {
      throw new PrivilegedServiceError("policy-denied", "Policy denied the protected operation");
    }

    if (stableDecision.effect === "allow") {
      if (approval !== undefined) {
        throw new PrivilegedServiceError(
          "approval-mismatch",
          "An allow decision cannot consume approval evidence",
        );
      }
      return {
        status: "granted",
        authorization: this.createGrant(stableOperation, stableDecision, "policy"),
      };
    }

    if (approval === undefined) {
      return {
        status: "approval-required",
        approval: await this.requestApproval(stableOperation, stableDecision),
      };
    }

    approvalId(approval);
    return {
      status: "granted",
      authorization: await this.consumeApproval(stableOperation, stableDecision, approval),
    };
  }

  async resolve(
    approval: ApprovalId,
    decision: UserApprovalDecision,
    actor: ApprovalActorId,
  ): Promise<ApprovalRequestSnapshot> {
    approvalId(approval);
    approvalActorId(actor);
    if (!["approved", "denied", "cancelled"].includes(decision)) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Approval decision must be approved, denied, or cancelled",
      );
    }

    const record = this.approvals.get(approval);
    if (record === undefined) {
      throw new PrivilegedServiceError("approval-not-found", "Approval request was not found");
    }
    const now = this.now();

    if (record.state !== "pending") {
      throw new PrivilegedServiceError(
        "approval-not-granted",
        "Approval request is already terminal",
      );
    }
    if (compareInstants(now, record.expiresAt) >= 0) {
      await this.expire(record, now);
      throw new PrivilegedServiceError("approval-expired", "Approval request has expired");
    }

    await this.appendAudit({
      type: "approval.resolved",
      context: auditContextFor(record.operation),
      approvalId: record.approvalId,
      decision,
      actorId: actor,
    });
    record.state = decision;
    record.resolvedAt = now;
    record.resolvedBy = actor;
    return snapshot(record);
  }

  async get(approval: ApprovalId): Promise<ApprovalRequestSnapshot | undefined> {
    approvalId(approval);
    const record = this.approvals.get(approval);
    return record === undefined ? undefined : snapshot(record);
  }

  private now() {
    const now = this.config.clock.now();
    instant(now);
    return now;
  }

  private async appendAudit(event: Parameters<AuditTrail["append"]>[0]): Promise<void> {
    try {
      const record = await this.config.auditTrail.append(event);
      assertAuditRecord(record);
      if (!isDeepStrictEqual(record.event, event)) {
        throw new PrivilegedServiceError(
          "audit-unavailable",
          "Audit trail acknowledged a different approval event",
        );
      }
    } catch (error) {
      if (error instanceof PrivilegedServiceError && error.code === "audit-unavailable") {
        throw error;
      }
      throw new PrivilegedServiceError(
        "audit-unavailable",
        "Approval audit evidence could not be recorded",
      );
    }
  }

  private async requestApproval(
    operation: ProtectedOperation,
    decision: PolicyDecision,
  ): Promise<ApprovalRequestSnapshot> {
    const existingId = this.approvalByRequest.get(operation.requestId);
    if (existingId !== undefined) {
      const existing = this.approvals.get(existingId);
      this.assertApprovalContext(existing, operation, decision);
      if (
        existing !== undefined &&
        existing.state === "pending" &&
        compareInstants(this.now(), existing.expiresAt) >= 0
      ) {
        await this.expire(existing, this.now());
        throw new PrivilegedServiceError("approval-expired", "Approval request has expired");
      }
      if (existing === undefined) {
        throw new PrivilegedServiceError(
          "approval-mismatch",
          "Approval request reservation is inconsistent",
        );
      }
      return snapshot(existing);
    }

    const inFlight = this.approvalCreations.get(operation.requestId);
    if (inFlight !== undefined) {
      const approval = await inFlight;
      this.assertApprovalSnapshotContext(approval, operation, decision);
      return approval;
    }

    const creation = Promise.resolve().then(() => this.createApproval(operation, decision));
    this.approvalCreations.set(operation.requestId, creation);
    try {
      return await creation;
    } finally {
      if (this.approvalCreations.get(operation.requestId) === creation) {
        this.approvalCreations.delete(operation.requestId);
      }
    }
  }

  private async createApproval(
    operation: ProtectedOperation,
    decision: PolicyDecision,
  ): Promise<ApprovalRequestSnapshot> {
    const approval = this.config.newApprovalId();
    try {
      approvalId(approval);
    } catch {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Approval identifier source returned an invalid identifier",
      );
    }
    if (this.approvals.has(approval)) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Approval identifier source returned a duplicate identifier",
      );
    }

    const requestedAt = this.now();
    const record: StoredApproval = {
      approvalId: approval,
      operation: immutableOperation(operation),
      policyRevision: decision.policyRevision,
      state: "pending",
      requestedAt,
      expiresAt: addDuration(requestedAt, this.config.ttlMs),
    };
    await this.appendAudit({
      type: "approval.requested",
      context: auditContextFor(operation),
      approvalId: approval,
      policyRevision: decision.policyRevision,
      expiresAt: record.expiresAt,
    });
    this.approvals.set(approval, record);
    this.approvalByRequest.set(operation.requestId, approval);
    return snapshot(record);
  }

  private assertApprovalContext(
    record: StoredApproval | undefined,
    operation: ProtectedOperation,
    decision: PolicyDecision,
  ): void {
    if (
      record === undefined ||
      !protectedOperationsEqual(record.operation, operation) ||
      record.policyRevision !== decision.policyRevision
    ) {
      throw new PrivilegedServiceError(
        "approval-mismatch",
        "A tool request cannot be rebound to changed approval context",
      );
    }
  }

  private assertApprovalSnapshotContext(
    approval: ApprovalRequestSnapshot,
    operation: ProtectedOperation,
    decision: PolicyDecision,
  ): void {
    if (
      !protectedOperationsEqual(approval.operation, operation) ||
      approval.policyRevision !== decision.policyRevision
    ) {
      throw new PrivilegedServiceError(
        "approval-mismatch",
        "A concurrent tool request cannot rebind approval context",
      );
    }
  }

  private async consumeApproval(
    operation: ProtectedOperation,
    decision: PolicyDecision,
    approval: ApprovalId,
  ): Promise<AuthorizationGrant> {
    const record = this.approvals.get(approval);
    if (record === undefined) {
      throw new PrivilegedServiceError("approval-not-found", "Approval request was not found");
    }
    if (
      decision.effect !== "require-approval" ||
      decision.policyRevision !== record.policyRevision ||
      decision.requestId !== record.operation.requestId ||
      !protectedOperationsEqual(operation, record.operation)
    ) {
      throw new PrivilegedServiceError(
        "approval-mismatch",
        "Approval evidence does not match the current operation and policy",
      );
    }

    const now = this.now();
    if (compareInstants(now, record.expiresAt) >= 0) {
      if (record.state === "pending") {
        await this.expire(record, now);
      }
      throw new PrivilegedServiceError("approval-expired", "Approval evidence has expired");
    }
    if (record.state !== "approved") {
      throw new PrivilegedServiceError("approval-not-granted", "Approval evidence is not approved");
    }
    if (record.consumedAt !== undefined || record.consumptionPending === true) {
      throw new PrivilegedServiceError(
        "approval-replayed",
        "Approval evidence has already been consumed",
      );
    }

    record.consumptionPending = true;
    try {
      const grant = this.createGrant(operation, decision, "approval", approval);
      await this.appendAudit({
        type: "approval.consumed",
        context: auditContextFor(operation),
        approvalId: approval,
        grantId: grant.grantId,
      });
      record.consumedAt = now;
      return grant;
    } finally {
      record.consumptionPending = false;
    }
  }

  private createGrant(
    operation: ProtectedOperation,
    decision: PolicyDecision,
    method: AuthorizationGrant["method"],
    approval?: ApprovalId,
  ): AuthorizationGrant {
    const grantId = this.config.newGrantId();
    try {
      authorizationGrantId(grantId);
    } catch {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Authorization identifier source returned an invalid identifier",
      );
    }
    if (this.grantIds.has(grantId)) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Authorization identifier source returned a duplicate identifier",
      );
    }

    const grant = Object.freeze({
      grantId,
      requestId: operation.requestId,
      workspaceId: operation.workspaceId,
      taskId: operation.taskId,
      sessionId: operation.sessionId,
      workerId: operation.workerId,
      toolId: operation.toolId,
      inputRef: operation.inputRef,
      action: operation.action,
      resourceKind: operation.resourceKind,
      credentialRefs: Object.freeze([...operation.credentialRefs]),
      policyDecisionId: decision.decisionId,
      policyRevision: decision.policyRevision,
      method,
      ...(approval === undefined ? {} : { approvalId: approval }),
      issuedAt: this.now(),
    }) satisfies AuthorizationGrant;
    assertAuthorizationGrant(grant);
    this.grantIds.add(grantId);
    return grant;
  }

  private async expire(record: StoredApproval, now: ApprovalRequestSnapshot["resolvedAt"]) {
    await this.appendAudit({
      type: "approval.resolved",
      context: auditContextFor(record.operation),
      approvalId: record.approvalId,
      decision: "expired",
    });
    record.state = "expired";
    record.resolvedAt = now;
  }
}
