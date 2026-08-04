import { isDeepStrictEqual } from "node:util";
import {
  PrivilegedServiceError,
  assertApprovalRequestSnapshot,
  assertAuditRecord,
  auditContextFor,
  type ApprovalActorId,
  type ApprovalRequestSnapshot,
  type AuditEvent,
  type AuditRecord,
  type AuditRecordId,
  type AuditTrail,
} from "../../core";

export interface PendingApprovalAuditEvidence {
  readonly policyAuditRecordId: AuditRecordId;
  readonly requestAuditRecordId: AuditRecordId;
}

function unavailable(message: string): PrivilegedServiceError {
  return new PrivilegedServiceError("audit-unavailable", message);
}

function matchesApprovalContext(record: AuditRecord, approval: ApprovalRequestSnapshot): boolean {
  return (
    record.event.context.requestId === approval.operation.requestId &&
    isDeepStrictEqual(record.event.context, auditContextFor(approval.operation))
  );
}

function findLastRecord(
  records: readonly AuditRecord[],
  predicate: (record: AuditRecord) => boolean,
): AuditRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record !== undefined && predicate(record)) return record;
  }
  return undefined;
}

export class ApprovalAuditEvidenceTrail implements AuditTrail {
  readonly #records: AuditRecord[] = [];

  constructor(private readonly delegate: AuditTrail) {}

  async append(event: AuditEvent): Promise<AuditRecord> {
    const record = await this.delegate.append(event);
    assertAuditRecord(record);
    if (!isDeepStrictEqual(record.event, event)) {
      throw unavailable("Approval audit trail acknowledged different evidence");
    }
    this.#records.push(record);
    return record;
  }

  pending(approval: ApprovalRequestSnapshot): PendingApprovalAuditEvidence {
    assertApprovalRequestSnapshot(approval);
    const request = findLastRecord(
      this.#records,
      (record) =>
        record.event.type === "approval.requested" &&
        record.event.approvalId === approval.approvalId &&
        record.event.policyRevision === approval.policyRevision &&
        record.event.expiresAt === approval.expiresAt &&
        matchesApprovalContext(record, approval),
    );
    if (request === undefined) {
      throw unavailable("Approval request audit evidence is unavailable");
    }
    const policy = findLastRecord(
      this.#records.slice(0, this.#records.indexOf(request)),
      (record) =>
        record.event.type === "policy.evaluated" &&
        record.event.policyRevision === approval.policyRevision &&
        record.event.decision === "require-approval" &&
        matchesApprovalContext(record, approval),
    );
    if (policy === undefined) {
      throw unavailable("Approval policy audit evidence is unavailable");
    }
    return Object.freeze({
      policyAuditRecordId: policy.recordId,
      requestAuditRecordId: request.recordId,
    });
  }

  async recordDecision(
    approval: ApprovalRequestSnapshot,
    decision: "approved" | "denied",
    actorId: ApprovalActorId,
  ): Promise<AuditRecordId> {
    assertApprovalRequestSnapshot(approval);
    const existing = findLastRecord(
      this.#records,
      (record) =>
        record.event.type === "approval.decision-recorded" &&
        record.event.approvalId === approval.approvalId,
    );
    if (existing !== undefined) {
      if (
        existing.event.type !== "approval.decision-recorded" ||
        existing.event.decision !== decision ||
        existing.event.actorId !== actorId ||
        !matchesApprovalContext(existing, approval)
      ) {
        throw unavailable("Approval decision audit evidence is bound to different authority");
      }
      return existing.recordId;
    }
    const record = await this.append({
      type: "approval.decision-recorded",
      context: auditContextFor(approval.operation),
      approvalId: approval.approvalId,
      decision,
      actorId,
    });
    return record.recordId;
  }

  resolution(
    approval: ApprovalRequestSnapshot,
    decision: "approved" | "denied",
    actorId: ApprovalActorId,
  ): AuditRecordId {
    assertApprovalRequestSnapshot(approval);
    const record = findLastRecord(
      this.#records,
      (candidate) =>
        candidate.event.type === "approval.resolved" &&
        candidate.event.approvalId === approval.approvalId &&
        candidate.event.decision === decision &&
        candidate.event.actorId === actorId &&
        matchesApprovalContext(candidate, approval),
    );
    if (record === undefined) {
      throw unavailable("Approval resolution audit evidence is unavailable");
    }
    return record.recordId;
  }
}
