import { describe, expect, it } from "vitest";
import {
  PRIVILEGED_CONTRACT_VERSION,
  PrivilegedServiceError,
  assertApprovalRequestSnapshot,
  assertAuditEvent,
  assertAuthorizationGrant,
  assertCredentialLease,
  assertPolicyDecision,
  assertPolicySnapshot,
  assertProtectedOperation,
  assertToolCapabilityManifest,
  compareInstants,
  credentialReference,
  instant,
  policyRuleId,
  toolId,
  type PrivilegedServiceErrorCode,
} from "../../apps/desktop/src/core";
import {
  PRIVILEGED_ACTOR_ID,
  PRIVILEGED_APPROVAL_ID,
  PRIVILEGED_CREDENTIAL_REFERENCE,
  createApprovalSnapshot,
  createAuthorizationGrant,
  createCredentialLease,
  createPolicyDecision,
  createPolicyRule,
  createPolicySnapshot,
  createProtectedOperation,
  createToolManifest,
} from "../fixtures/privilegedServices";

function expectPrivilegedError(operation: () => unknown, code: PrivilegedServiceErrorCode): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PrivilegedServiceError);
    expect((error as PrivilegedServiceError).code).toBe(code);
    return;
  }

  throw new Error(`Expected PrivilegedServiceError with code ${code}`);
}

describe("Privileged service contracts", () => {
  it("accepts one closed operation and rejects inline authority or duplicate references", () => {
    expect(() => assertProtectedOperation(createProtectedOperation())).not.toThrow();

    expectPrivilegedError(
      () =>
        assertProtectedOperation({
          ...createProtectedOperation(),
          credentialValue: "forbidden-inline-material",
        }),
      "invalid-contract",
    );
    expectPrivilegedError(
      () =>
        assertProtectedOperation({
          ...createProtectedOperation(),
          action: "filesystem.everything",
        }),
      "invalid-contract",
    );
    expectPrivilegedError(
      () =>
        assertProtectedOperation({
          ...createProtectedOperation(),
          credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE, PRIVILEGED_CREDENTIAL_REFERENCE],
        }),
      "invalid-contract",
    );
  });

  it("accepts conservative rules and rejects ambiguous or unknown policy shapes", () => {
    expect(() => assertPolicySnapshot(createPolicySnapshot())).not.toThrow();

    expectPrivilegedError(
      () =>
        assertPolicySnapshot(
          createPolicySnapshot([
            createPolicyRule(),
            createPolicyRule({
              effect: "deny",
            }),
          ]),
        ),
      "invalid-policy",
    );
    expectPrivilegedError(
      () =>
        assertPolicySnapshot(
          createPolicySnapshot([
            createPolicyRule({
              id: policyRuleId("rule-empty"),
              actions: [],
            }),
          ]),
        ),
      "invalid-policy",
    );
    expectPrivilegedError(
      () =>
        assertPolicySnapshot({
          ...createPolicySnapshot(),
          contractVersion: PRIVILEGED_CONTRACT_VERSION + 1,
        }),
      "invalid-policy",
    );
  });

  it("requires closed, bounded tool capability manifests", () => {
    expect(() => assertToolCapabilityManifest(createToolManifest())).not.toThrow();

    expectPrivilegedError(
      () =>
        assertToolCapabilityManifest({
          ...createToolManifest(),
          actions: ["shell.execute"],
          hiddenAutomaticApproval: true,
        }),
      "invalid-manifest",
    );
    expectPrivilegedError(
      () =>
        assertToolCapabilityManifest({
          ...createToolManifest(),
          timeoutMs: 0,
        }),
      "invalid-manifest",
    );
  });

  it("validates approval terminal, expiry, actor, and one-shot consumption fields", () => {
    const resolvedAt = instant("2026-07-28T08:00:02.000Z");
    const approved = createApprovalSnapshot({
      state: "approved",
      resolvedAt,
      resolvedBy: PRIVILEGED_ACTOR_ID,
      consumedAt: instant("2026-07-28T08:00:03.000Z"),
    });
    expect(() => assertApprovalRequestSnapshot(createApprovalSnapshot())).not.toThrow();
    expect(() => assertApprovalRequestSnapshot(approved)).not.toThrow();
    expect(() =>
      assertApprovalRequestSnapshot(
        createApprovalSnapshot({
          state: "expired",
          resolvedAt: createApprovalSnapshot().expiresAt,
        }),
      ),
    ).not.toThrow();

    for (const invalid of [
      {
        ...approved,
        state: "pending",
      },
      {
        ...approved,
        resolvedBy: undefined,
      },
      createApprovalSnapshot({
        state: "expired",
        resolvedAt: createApprovalSnapshot().expiresAt,
        resolvedBy: PRIVILEGED_ACTOR_ID,
      }),
      createApprovalSnapshot({
        state: "approved",
        resolvedAt: createApprovalSnapshot().expiresAt,
        resolvedBy: PRIVILEGED_ACTOR_ID,
      }),
      {
        ...approved,
        consumedAt: instant("2026-07-28T08:00:01.500Z"),
      },
      createApprovalSnapshot({
        state: "denied",
        resolvedAt,
        resolvedBy: PRIVILEGED_ACTOR_ID,
        consumedAt: instant("2026-07-28T08:00:03.000Z"),
      }),
    ]) {
      expectPrivilegedError(() => assertApprovalRequestSnapshot(invalid), "invalid-contract");
    }
  });

  it("enforces authorization method and approval-reference exclusivity", () => {
    expect(() => assertAuthorizationGrant(createAuthorizationGrant())).not.toThrow();
    expect(() =>
      assertAuthorizationGrant(
        createAuthorizationGrant({
          method: "approval",
          approvalId: PRIVILEGED_APPROVAL_ID,
        }),
      ),
    ).not.toThrow();

    expectPrivilegedError(
      () =>
        assertAuthorizationGrant(
          createAuthorizationGrant({
            method: "approval",
          }),
        ),
      "invalid-contract",
    );
    expectPrivilegedError(
      () =>
        assertAuthorizationGrant(
          createAuthorizationGrant({
            approvalId: PRIVILEGED_APPROVAL_ID,
          }),
        ),
      "invalid-contract",
    );
  });

  it("binds policy effects to reason codes and matched rules", () => {
    expect(() => assertPolicyDecision(createPolicyDecision())).not.toThrow();
    expect(() =>
      assertPolicyDecision(
        createPolicyDecision({
          effect: "deny",
          reasonCode: "no-matching-rule",
          matchedRuleIds: [],
        }),
      ),
    ).not.toThrow();

    expectPrivilegedError(
      () =>
        assertPolicyDecision(
          createPolicyDecision({
            reasonCode: "matching-rule-deny",
          }),
        ),
      "invalid-policy",
    );
    expectPrivilegedError(
      () =>
        assertPolicyDecision(
          createPolicyDecision({
            matchedRuleIds: [],
            reasonCode: "no-matching-rule",
          }),
        ),
      "invalid-policy",
    );
  });

  it("requires operation-bound credential leases with a positive lifetime", () => {
    expect(() => assertCredentialLease(createCredentialLease())).not.toThrow();
    expectPrivilegedError(
      () =>
        assertCredentialLease(
          createCredentialLease({
            expiresAt: createCredentialLease().issuedAt,
          }),
        ),
      "invalid-contract",
    );
    expectPrivilegedError(
      () =>
        assertCredentialLease({
          ...createCredentialLease(),
          credentialValue: "forbidden-inline-material",
        }),
      "invalid-contract",
    );
  });

  it("orders canonical extended-year instants by time rather than string form", () => {
    const yearTenThousand = instant("+010000-01-01T00:00:00.000Z");
    const yearNineThousand = instant("9999-01-01T00:00:00.000Z");

    expect(compareInstants(yearTenThousand, yearNineThousand)).toBe(1);
    expect(compareInstants(yearNineThousand, yearTenThousand)).toBe(-1);
    expect(compareInstants(yearTenThousand, yearTenThousand)).toBe(0);
  });

  it("allows only metadata audit events and rejects content-bearing fields", () => {
    expect(() =>
      assertAuditEvent({
        type: "policy.evaluated",
        context: {
          requestId: createProtectedOperation().requestId,
          workspaceId: createProtectedOperation().workspaceId,
          taskId: createProtectedOperation().taskId,
          sessionId: createProtectedOperation().sessionId,
          workerId: createProtectedOperation().workerId,
          toolId: createProtectedOperation().toolId,
          action: "workspace.read",
          resourceKind: "workspace",
        },
        policyRevision: createPolicySnapshot().revision,
        decision: "allow",
        reasonCode: "matching-rule-allow",
        matchedRuleIds: [policyRuleId("rule-workspace-read")],
      }),
    ).not.toThrow();

    expectPrivilegedError(
      () =>
        assertAuditEvent({
          type: "tool.started",
          context: {
            requestId: createProtectedOperation().requestId,
            workspaceId: createProtectedOperation().workspaceId,
            taskId: createProtectedOperation().taskId,
            sessionId: createProtectedOperation().sessionId,
            workerId: createProtectedOperation().workerId,
            toolId: toolId("tool-workspace-read"),
            action: "workspace.read",
            resourceKind: "workspace",
          },
          authorizationMethod: "policy",
          summary: "must-not-enter-audit",
        }),
      "invalid-audit",
    );
  });

  it("constructs opaque credential references without accepting padded identifiers", () => {
    expect(credentialReference("credential-reference-1")).toBe("credential-reference-1");
    expectPrivilegedError(() => credentialReference(" credential-reference-1"), "invalid-contract");
  });
});
