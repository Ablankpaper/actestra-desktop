import { describe, expect, it } from "vitest";
import {
  approvalActorId,
  auditContextFor,
  auditRecordId,
  instant,
  policyRuleId,
} from "../../apps/desktop/src/core";
import { ApprovalAuditEvidenceTrail } from "../../apps/desktop/src/main/privileged/approvalAuditEvidence";
import { InMemoryAuditTrail } from "../../apps/desktop/src/main/privileged/inMemoryAuditTrail";
import { createApprovalSnapshot, createProtectedOperation } from "../fixtures/privilegedServices";

describe("ApprovalAuditEvidenceTrail", () => {
  it("returns only exact persisted policy, request, decision, and resolution record identities", async () => {
    let sequence = 0;
    const backing = new InMemoryAuditTrail({ now: () => instant("2026-08-05T01:00:00.000Z") }, () =>
      auditRecordId(`audit-team-approval-${String(++sequence)}`),
    );
    const evidence = new ApprovalAuditEvidenceTrail(backing);
    const operation = createProtectedOperation({
      action: "shell.execute",
      resourceKind: "repository",
    });
    const approval = createApprovalSnapshot({ operation });

    await evidence.append({
      type: "policy.evaluated",
      context: auditContextFor(operation),
      policyRevision: approval.policyRevision,
      decision: "require-approval",
      reasonCode: "matching-rule-approval",
      matchedRuleIds: [policyRuleId("rule-team-approval")],
    });
    await evidence.append({
      type: "approval.requested",
      context: auditContextFor(operation),
      approvalId: approval.approvalId,
      policyRevision: approval.policyRevision,
      expiresAt: approval.expiresAt,
    });

    expect(evidence.pending(approval)).toEqual({
      policyAuditRecordId: "audit-team-approval-1",
      requestAuditRecordId: "audit-team-approval-2",
    });

    const actorId = approvalActorId("actestra-team-owner");
    await expect(evidence.recordDecision(approval, "approved", actorId)).resolves.toBe(
      "audit-team-approval-3",
    );
    await evidence.append({
      type: "approval.resolved",
      context: auditContextFor(operation),
      approvalId: approval.approvalId,
      decision: "approved",
      actorId,
    });

    expect(evidence.resolution(approval, "approved", actorId)).toBe("audit-team-approval-4");
    expect(backing.snapshot().map(({ event }) => event.type)).toEqual([
      "policy.evaluated",
      "approval.requested",
      "approval.decision-recorded",
      "approval.resolved",
    ]);
  });

  it("fails closed when pending or resolution evidence belongs to different authority", async () => {
    let sequence = 0;
    const backing = new InMemoryAuditTrail({ now: () => instant("2026-08-05T01:00:00.000Z") }, () =>
      auditRecordId(`audit-team-mismatch-${String(++sequence)}`),
    );
    const evidence = new ApprovalAuditEvidenceTrail(backing);
    const operation = createProtectedOperation({
      action: "shell.execute",
      resourceKind: "repository",
    });
    const approval = createApprovalSnapshot({ operation });

    await evidence.append({
      type: "policy.evaluated",
      context: auditContextFor(operation),
      policyRevision: approval.policyRevision,
      decision: "require-approval",
      reasonCode: "matching-rule-approval",
      matchedRuleIds: [policyRuleId("rule-team-approval")],
    });
    expect(() => evidence.pending(approval)).toThrow(/request audit evidence/u);

    await evidence.append({
      type: "approval.requested",
      context: auditContextFor(operation),
      approvalId: approval.approvalId,
      policyRevision: approval.policyRevision,
      expiresAt: approval.expiresAt,
    });
    const actorId = approvalActorId("actestra-team-owner");
    await evidence.append({
      type: "approval.resolved",
      context: auditContextFor(operation),
      approvalId: approval.approvalId,
      decision: "denied",
      actorId,
    });

    expect(() => evidence.resolution(approval, "approved", actorId)).toThrow(
      /resolution audit evidence/u,
    );
  });
});
