import { describe, expect, it } from "vitest";
import {
  PrivilegedServiceError,
  approvalActorId,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  credentialReference,
  instant,
  policyDecisionId,
  policyRuleId,
  toolOutputReference,
  type AuditEvent,
  type AuditRecord,
  type AuditTrail,
  type CredentialLease,
  type CredentialReference,
  type Instant,
  type ProtectedToolExecutor,
  type ToolExecutionRequest,
  type ToolExecutionResult,
} from "../../apps/desktop/src/core";
import { InMemoryApprovalService } from "../../apps/desktop/src/main/privileged/inMemoryApprovalService";
import { InMemoryAuditTrail } from "../../apps/desktop/src/main/privileged/inMemoryAuditTrail";
import { DeterministicPolicyEngine } from "../../apps/desktop/src/main/privileged/deterministicPolicyEngine";
import { ReferenceCredentialBroker } from "../../apps/desktop/src/main/privileged/referenceCredentialBroker";
import { PrivilegedToolGateway } from "../../apps/desktop/src/main/privileged/toolGateway";
import {
  PRIVILEGED_CREDENTIAL_REFERENCE,
  PRIVILEGED_TOOL_ID,
  createAuthorizationGrant,
  createPolicyDecision,
  createPolicyRule,
  createPolicySnapshot,
  createProtectedOperation,
  createToolManifest,
} from "../fixtures/privilegedServices";

class TestClock {
  private current: Instant;

  constructor(initial: Instant = instant("2026-07-28T08:00:00.000Z")) {
    this.current = initial;
  }

  now(): Instant {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = instant(new Date(Date.parse(this.current) + milliseconds).toISOString());
  }

  set(value: Instant): void {
    this.current = value;
  }
}

class TestExecutor implements ProtectedToolExecutor {
  readonly executions: ToolExecutionRequest[] = [];
  failure?: Error;

  constructor(readonly manifestValue = createToolManifest()) {}

  async manifest() {
    return this.manifestValue;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    this.executions.push(request);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return {
      status: "succeeded",
      outputRef: toolOutputReference("tool-output-privileged"),
    };
  }
}

class BlockingAuditTrail implements AuditTrail {
  readonly entered: Promise<void>;
  private enter!: () => void;
  private releaseBlock!: () => void;
  private readonly blocked: Promise<void>;
  private hasBlocked = false;
  private auditSequence = 0;
  private readonly delegate: InMemoryAuditTrail;

  constructor(
    clock: TestClock,
    private readonly blockedType: AuditEvent["type"],
  ) {
    this.entered = new Promise((resolve) => {
      this.enter = resolve;
    });
    this.blocked = new Promise((resolve) => {
      this.releaseBlock = resolve;
    });
    this.delegate = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`blocking-audit-${String(++this.auditSequence)}`),
    );
  }

  async append(event: AuditEvent): Promise<AuditRecord> {
    if (!this.hasBlocked && event.type === this.blockedType) {
      this.hasBlocked = true;
      this.enter();
      await this.blocked;
    }
    return this.delegate.append(event);
  }

  release(): void {
    this.releaseBlock();
  }

  snapshot(): readonly AuditRecord[] {
    return this.delegate.snapshot();
  }
}

function createHarness(
  options: {
    readonly rules?: Parameters<typeof createPolicySnapshot>[0];
    readonly executor?: TestExecutor;
    readonly auditTrail?: AuditTrail;
    readonly auditTrailFactory?: (clock: TestClock) => AuditTrail;
  } = {},
) {
  const clock = new TestClock();
  let decisionSequence = 0;
  let approvalSequence = 0;
  let grantSequence = 0;
  let leaseSequence = 0;
  let auditSequence = 0;
  const auditTrail =
    options.auditTrailFactory?.(clock) ??
    options.auditTrail ??
    new InMemoryAuditTrail(clock, () => auditRecordId(`audit-record-${String(++auditSequence)}`));
  const policyEngine = new DeterministicPolicyEngine(
    createPolicySnapshot(options.rules),
    clock,
    () => policyDecisionId(`policy-decision-${String(++decisionSequence)}`),
  );
  const approvalService = new InMemoryApprovalService({
    clock,
    auditTrail,
    ttlMs: 1_000,
    newApprovalId: () => approvalId(`approval-service-${String(++approvalSequence)}`),
    newGrantId: () => authorizationGrantId(`authorization-grant-${String(++grantSequence)}`),
  });
  const credentialBroker = new ReferenceCredentialBroker({
    clock,
    auditTrail,
    leaseTtlMs: 500,
    historyRetentionMs: 5_000,
    newLeaseId: () => credentialLeaseId(`credential-lease-${String(++leaseSequence)}`),
  });
  const executor = options.executor ?? new TestExecutor();
  const gateway = new PrivilegedToolGateway({
    policyEngine,
    approvalService,
    credentialBroker,
    auditTrail,
    executor,
  });

  return {
    approvalService,
    auditTrail,
    clock,
    credentialBroker,
    executor,
    gateway,
  };
}

describe("P3.5 privileged services", () => {
  it("executes an explicitly allowed operation only after policy and start audit evidence", async () => {
    const harness = createHarness();

    await expect(harness.gateway.invoke(createProtectedOperation())).resolves.toMatchObject({
      status: "executed",
      result: {
        status: "succeeded",
      },
    });

    expect(harness.executor.executions).toHaveLength(1);
    const audit = (harness.auditTrail as InMemoryAuditTrail).snapshot();
    expect(audit.map(({ event }) => event.type)).toEqual([
      "policy.evaluated",
      "tool.started",
      "tool.completed",
    ]);
    expect(audit.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(audit.every((record) => Object.isFrozen(record) && Object.isFrozen(record.event))).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain("Read files inside the approved workspace");
    expect(JSON.stringify(audit)).not.toContain("tool-input-privileged");
  });

  it("requires one exact approval, consumes it once, and rejects replay", async () => {
    const harness = createHarness({
      rules: [
        createPolicyRule({
          id: policyRuleId("rule-shell-approval"),
          effect: "require-approval",
          actions: ["shell.execute"],
          resourceKinds: ["repository"],
        }),
      ],
      executor: new TestExecutor(
        createToolManifest({
          actions: ["shell.execute"],
          resourceKinds: ["repository"],
        }),
      ),
    });
    const operation = createProtectedOperation({
      action: "shell.execute",
      resourceKind: "repository",
      summary: "Run the approved repository check",
    });

    const pending = await harness.gateway.invoke(operation);
    expect(pending).toMatchObject({
      status: "approval-required",
      approval: {
        state: "pending",
      },
    });
    expect(harness.executor.executions).toHaveLength(0);
    if (pending.status !== "approval-required") {
      throw new Error("Expected an approval request");
    }

    await harness.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("local-user"),
    );
    await expect(
      harness.gateway.invoke(
        {
          ...operation,
          summary: "Changed after approval",
        },
        pending.approval.approvalId,
      ),
    ).rejects.toMatchObject({
      code: "approval-mismatch",
      mayHaveExecuted: false,
    });
    await expect(
      harness.gateway.invoke(operation, pending.approval.approvalId),
    ).resolves.toMatchObject({
      status: "executed",
      authorization: {
        method: "approval",
        approvalId: pending.approval.approvalId,
      },
    });
    await expect(
      harness.gateway.invoke(operation, pending.approval.approvalId),
    ).rejects.toMatchObject({
      code: "approval-replayed",
      mayHaveExecuted: false,
    });
    expect(harness.executor.executions).toHaveLength(1);
  });

  it("shares one approval creation across concurrent authorization calls", async () => {
    const clock = new TestClock();
    const audit = new BlockingAuditTrail(clock, "approval.requested");
    let approvalSequence = 0;
    let grantSequence = 0;
    const service = new InMemoryApprovalService({
      clock,
      auditTrail: audit,
      ttlMs: 1_000,
      newApprovalId: () => approvalId(`concurrent-approval-${String(++approvalSequence)}`),
      newGrantId: () => authorizationGrantId(`concurrent-grant-${String(++grantSequence)}`),
    });
    const operation = createProtectedOperation();
    const decision = createPolicyDecision({
      effect: "require-approval",
      reasonCode: "matching-rule-approval",
    });

    const first = service.authorize(operation, decision);
    await audit.entered;
    const second = service.authorize(operation, decision);
    audit.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe("approval-required");
    expect(secondResult.status).toBe("approval-required");
    if (firstResult.status !== "approval-required" || secondResult.status !== "approval-required") {
      throw new Error("Expected shared approval requests");
    }
    expect(secondResult.approval.approvalId).toBe(firstResult.approval.approvalId);
    expect(approvalSequence).toBe(1);
    expect(
      audit.snapshot().filter(({ event }) => event.type === "approval.requested"),
    ).toHaveLength(1);
  });

  it("claims approved evidence before awaiting audit so concurrent replay fails", async () => {
    const clock = new TestClock();
    const audit = new BlockingAuditTrail(clock, "approval.consumed");
    let approvalSequence = 0;
    let grantSequence = 0;
    const service = new InMemoryApprovalService({
      clock,
      auditTrail: audit,
      ttlMs: 1_000,
      newApprovalId: () => approvalId(`claimed-approval-${String(++approvalSequence)}`),
      newGrantId: () => authorizationGrantId(`claimed-grant-${String(++grantSequence)}`),
    });
    const operation = createProtectedOperation();
    const decision = createPolicyDecision({
      effect: "require-approval",
      reasonCode: "matching-rule-approval",
    });
    const pending = await service.authorize(operation, decision);
    if (pending.status !== "approval-required") {
      throw new Error("Expected an approval request");
    }
    await service.resolve(pending.approval.approvalId, "approved", approvalActorId("local-user"));

    const first = service.authorize(operation, decision, pending.approval.approvalId);
    await audit.entered;
    await expect(
      service.authorize(operation, decision, pending.approval.approvalId),
    ).rejects.toMatchObject({
      code: "approval-replayed",
    });
    audit.release();
    await expect(first).resolves.toMatchObject({
      status: "granted",
      authorization: {
        method: "approval",
      },
    });
    expect(grantSequence).toBe(1);
  });

  it("releases an approval consumption claim when its audit append fails", async () => {
    const clock = new TestClock();
    let auditSequence = 0;
    const recorded = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`claim-rollback-audit-${String(++auditSequence)}`),
    );
    let failConsumption = true;
    const audit: AuditTrail = {
      async append(event) {
        if (event.type === "approval.consumed" && failConsumption) {
          failConsumption = false;
          throw new PrivilegedServiceError(
            "audit-unavailable",
            "Approval consumption audit is unavailable",
          );
        }
        return recorded.append(event);
      },
    };
    let approvalSequence = 0;
    let grantSequence = 0;
    const service = new InMemoryApprovalService({
      clock,
      auditTrail: audit,
      ttlMs: 1_000,
      newApprovalId: () => approvalId(`rollback-approval-${String(++approvalSequence)}`),
      newGrantId: () => authorizationGrantId(`rollback-grant-${String(++grantSequence)}`),
    });
    const operation = createProtectedOperation();
    const decision = createPolicyDecision({
      effect: "require-approval",
      reasonCode: "matching-rule-approval",
    });
    const pending = await service.authorize(operation, decision);
    if (pending.status !== "approval-required") {
      throw new Error("Expected an approval request");
    }
    await service.resolve(pending.approval.approvalId, "approved", approvalActorId("local-user"));

    await expect(
      service.authorize(operation, decision, pending.approval.approvalId),
    ).rejects.toMatchObject({
      code: "audit-unavailable",
    });
    await expect(
      service.authorize(operation, decision, pending.approval.approvalId),
    ).resolves.toMatchObject({
      status: "granted",
    });
    expect(grantSequence).toBe(2);
  });

  it("fails closed for deny precedence, missing rules, expiry, and cancellation", async () => {
    const denyHarness = createHarness({
      rules: [
        createPolicyRule(),
        createPolicyRule({
          id: policyRuleId("rule-explicit-deny"),
          effect: "deny",
        }),
      ],
    });
    await expect(denyHarness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "policy-denied",
      mayHaveExecuted: false,
    });
    expect(denyHarness.executor.executions).toHaveLength(0);

    const missingHarness = createHarness({
      rules: [],
    });
    await expect(missingHarness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "policy-denied",
    });
    await expect(
      missingHarness.gateway.invoke(
        createProtectedOperation({
          requestedAt: instant("2026-07-28T08:00:00.001Z"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid-contract",
      mayHaveExecuted: false,
    });

    const approvalHarness = createHarness({
      rules: [
        createPolicyRule({
          effect: "require-approval",
        }),
      ],
    });
    const pending = await approvalHarness.gateway.invoke(createProtectedOperation());
    if (pending.status !== "approval-required") {
      throw new Error("Expected an approval request");
    }
    approvalHarness.clock.advance(1_000);
    await expect(
      approvalHarness.approvalService.resolve(
        pending.approval.approvalId,
        "approved",
        approvalActorId("local-user"),
      ),
    ).rejects.toMatchObject({
      code: "approval-expired",
    });

    const cancelledHarness = createHarness({
      rules: [
        createPolicyRule({
          effect: "require-approval",
        }),
      ],
    });
    const cancellable = await cancelledHarness.gateway.invoke(createProtectedOperation());
    if (cancellable.status !== "approval-required") {
      throw new Error("Expected an approval request");
    }
    await cancelledHarness.approvalService.resolve(
      cancellable.approval.approvalId,
      "cancelled",
      approvalActorId("local-user"),
    );
    await expect(
      cancelledHarness.gateway.invoke(createProtectedOperation(), cancellable.approval.approvalId),
    ).rejects.toMatchObject({
      code: "approval-not-granted",
    });
    expect(cancelledHarness.executor.executions).toHaveLength(0);
  });

  it("orders extended-year policy and audit timestamps by normalized time", async () => {
    const yearNineThousand = instant("9999-01-01T00:00:00.000Z");
    const yearTenThousand = instant("+010000-01-01T00:00:00.000Z");
    const clock = new TestClock(yearTenThousand);
    let decisionSequence = 0;
    const engine = new DeterministicPolicyEngine(createPolicySnapshot(), clock, () =>
      policyDecisionId(`extended-decision-${String(++decisionSequence)}`),
    );
    await expect(
      engine.evaluate(
        createProtectedOperation({
          requestedAt: yearNineThousand,
        }),
      ),
    ).resolves.toMatchObject({
      effect: "allow",
    });

    const earlyClock = new TestClock(yearNineThousand);
    const earlyEngine = new DeterministicPolicyEngine(createPolicySnapshot(), earlyClock, () =>
      policyDecisionId("future-extended-decision"),
    );
    await expect(
      earlyEngine.evaluate(
        createProtectedOperation({
          requestedAt: yearTenThousand,
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid-contract",
    });

    let auditSequence = 0;
    const auditClock = new TestClock(yearNineThousand);
    const audit = new InMemoryAuditTrail(auditClock, () =>
      auditRecordId(`extended-audit-${String(++auditSequence)}`),
    );
    const policyEvent: AuditEvent = {
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
    };
    await audit.append(policyEvent);
    auditClock.set(yearTenThousand);
    await expect(audit.append(policyEvent)).resolves.toMatchObject({
      sequence: 2,
    });
  });

  it("passes only opaque credential leases to the executor and releases them", async () => {
    const executor = new TestExecutor(
      createToolManifest({
        credentialUse: "required",
      }),
    );
    const harness = createHarness({
      rules: [
        createPolicyRule({
          credentialUse: "required",
        }),
      ],
      executor,
    });

    await harness.gateway.invoke(
      createProtectedOperation({
        credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE],
      }),
    );

    expect(executor.executions[0]?.credentialLeases).toHaveLength(1);
    expect(executor.executions[0]?.credentialLeases[0]).toMatchObject({
      credentialRef: PRIVILEGED_CREDENTIAL_REFERENCE,
    });
    expect(Object.keys(executor.executions[0]?.credentialLeases[0] ?? {}).sort()).toEqual([
      "authorizationGrantId",
      "credentialRef",
      "expiresAt",
      "issuedAt",
      "leaseId",
      "requestId",
    ]);
    await expect(harness.credentialBroker.activeLeaseCount()).resolves.toBe(0);
  });

  it("audits rollback after partial lease issuance and sweeps expired leases", async () => {
    const rollbackClock = new TestClock();
    let rollbackAuditSequence = 0;
    const rollbackAudit = new InMemoryAuditTrail(rollbackClock, () =>
      auditRecordId(`rollback-audit-${String(++rollbackAuditSequence)}`),
    );
    const duplicateLeaseId = credentialLeaseId("credential-lease-rollback");
    const rollbackBroker = new ReferenceCredentialBroker({
      clock: rollbackClock,
      auditTrail: rollbackAudit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => duplicateLeaseId,
    });
    const secondCredential = credentialReference("credential-reference-secondary");
    const rollbackOperation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE, secondCredential],
    });

    await expect(
      rollbackBroker.lease(
        rollbackOperation,
        createAuthorizationGrant({
          credentialRefs: rollbackOperation.credentialRefs,
        }),
      ),
    ).rejects.toMatchObject({
      code: "credential-unavailable",
    });
    await expect(rollbackBroker.activeLeaseCount()).resolves.toBe(0);
    expect(rollbackAudit.snapshot().map(({ event }) => event.type)).toEqual([
      "credential.lease-issued",
      "credential.lease-released",
    ]);

    const expiryClock = new TestClock();
    let expiryAuditSequence = 0;
    const expiringLeaseId = credentialLeaseId("expiring-lease");
    const expiryAudit = new InMemoryAuditTrail(expiryClock, () =>
      auditRecordId(`expiry-audit-${String(++expiryAuditSequence)}`),
    );
    const expiryBroker = new ReferenceCredentialBroker({
      clock: expiryClock,
      auditTrail: expiryAudit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => expiringLeaseId,
    });
    const expiryOperation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE],
    });
    await expiryBroker.lease(
      expiryOperation,
      createAuthorizationGrant({
        credentialRefs: expiryOperation.credentialRefs,
      }),
    );
    await expect(expiryBroker.activeLeaseCount()).resolves.toBe(1);
    expiryClock.advance(500);
    await expect(expiryBroker.activeLeaseCount()).resolves.toBe(0);
    expiryClock.advance(1_000);
    const retainedAgain = await expiryBroker.lease(
      expiryOperation,
      createAuthorizationGrant({
        credentialRefs: expiryOperation.credentialRefs,
      }),
    );
    await expiryBroker.release(expiryOperation, retainedAgain);
    expect(expiryAudit.snapshot().map(({ event }) => event.type)).toEqual([
      "credential.lease-issued",
      "credential.lease-released",
      "credential.lease-issued",
      "credential.lease-released",
    ]);
  });

  it("serializes lease identifiers across concurrent broker mutations", async () => {
    const clock = new TestClock();
    let auditSequence = 0;
    const audit = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`serialized-audit-${String(++auditSequence)}`),
    );
    const fixedLeaseId = credentialLeaseId("serialized-lease");
    const broker = new ReferenceCredentialBroker({
      clock,
      auditTrail: audit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => fixedLeaseId,
    });
    const operation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE],
    });
    const authorization = createAuthorizationGrant({
      credentialRefs: operation.credentialRefs,
    });

    const results = await Promise.allSettled([
      broker.lease(operation, authorization),
      broker.lease(operation, authorization),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "credential-unavailable",
    });
    const fulfilled = results.find(
      (result): result is PromiseFulfilledResult<readonly CredentialLease[]> =>
        result.status === "fulfilled",
    );
    if (fulfilled === undefined) {
      throw new Error("Expected one serialized lease result");
    }
    await broker.release(operation, fulfilled.value);
    await expect(broker.activeLeaseCount()).resolves.toBe(0);
  });

  it("accepts semantically equal audit acknowledgements with reordered keys", async () => {
    const clock = new TestClock();
    let auditSequence = 0;
    const recorded = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`reordered-audit-${String(++auditSequence)}`),
    );
    const reorderedAudit: AuditTrail = {
      async append(event) {
        const reordered = Object.fromEntries(
          Object.entries(event).reverse(),
        ) as unknown as AuditEvent;
        return recorded.append(reordered);
      },
    };
    let leaseSequence = 0;
    const broker = new ReferenceCredentialBroker({
      clock,
      auditTrail: reorderedAudit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => credentialLeaseId(`reordered-lease-${String(++leaseSequence)}`),
    });
    const operation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE],
    });

    const leases = await broker.lease(
      operation,
      createAuthorizationGrant({
        credentialRefs: operation.credentialRefs,
      }),
    );
    await expect(broker.release(operation, leases)).resolves.toBeUndefined();
  });

  it("reclaims every expired lease before surfacing one audit failure", async () => {
    const clock = new TestClock();
    let auditSequence = 0;
    let releaseAttempts = 0;
    const recorded = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`failed-sweep-audit-${String(++auditSequence)}`),
    );
    const audit: AuditTrail = {
      async append(event) {
        if (event.type === "credential.lease-released") {
          releaseAttempts += 1;
          throw new PrivilegedServiceError(
            "audit-unavailable",
            "Expired lease audit is unavailable",
          );
        }
        return recorded.append(event);
      },
    };
    let leaseSequence = 0;
    const broker = new ReferenceCredentialBroker({
      clock,
      auditTrail: audit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => credentialLeaseId(`failed-sweep-${String(++leaseSequence)}`),
    });
    const secondCredential = credentialReference("credential-reference-sweep");
    const operation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE, secondCredential],
    });
    await broker.lease(
      operation,
      createAuthorizationGrant({
        credentialRefs: operation.credentialRefs,
      }),
    );
    clock.advance(500);

    await expect(broker.activeLeaseCount()).rejects.toMatchObject({
      code: "audit-unavailable",
    });
    expect(releaseAttempts).toBe(2);
    await expect(broker.activeLeaseCount()).resolves.toBe(0);
  });

  it("reclaims every requested lease before surfacing one release-audit failure", async () => {
    const clock = new TestClock();
    let auditSequence = 0;
    let releaseAttempts = 0;
    const recorded = new InMemoryAuditTrail(clock, () =>
      auditRecordId(`failed-release-audit-${String(++auditSequence)}`),
    );
    const audit: AuditTrail = {
      async append(event) {
        if (event.type === "credential.lease-released") {
          releaseAttempts += 1;
          throw new PrivilegedServiceError(
            "audit-unavailable",
            "Credential release audit is unavailable",
          );
        }
        return recorded.append(event);
      },
    };
    let leaseSequence = 0;
    const broker = new ReferenceCredentialBroker({
      clock,
      auditTrail: audit,
      leaseTtlMs: 500,
      historyRetentionMs: 1_000,
      newLeaseId: () => credentialLeaseId(`failed-release-${String(++leaseSequence)}`),
    });
    const secondCredential = credentialReference("credential-reference-release");
    const operation = createProtectedOperation({
      credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE, secondCredential],
    });
    const leases = await broker.lease(
      operation,
      createAuthorizationGrant({
        credentialRefs: operation.credentialRefs,
      }),
    );

    await expect(broker.release(operation, leases)).rejects.toMatchObject({
      code: "audit-unavailable",
    });
    expect(releaseAttempts).toBe(2);
    await expect(broker.activeLeaseCount()).resolves.toBe(0);
  });

  it("snapshots caller-owned operation data before the first asynchronous boundary", async () => {
    const harness = createHarness();
    const operation = createProtectedOperation();
    const invocation = harness.gateway.invoke(operation);
    (operation as { action: string }).action = "workspace.modify";
    (operation.credentialRefs as CredentialReference[]).push(PRIVILEGED_CREDENTIAL_REFERENCE);

    await expect(invocation).resolves.toMatchObject({
      status: "executed",
    });
    expect(harness.executor.executions[0]?.operation).toMatchObject({
      action: "workspace.read",
      credentialRefs: [],
    });
    expect(Object.isFrozen(harness.executor.executions[0]?.operation)).toBe(true);
    expect(Object.isFrozen(harness.executor.executions[0]?.operation.credentialRefs)).toBe(true);
  });

  it("rejects manifest drift and unavailable audit before execution", async () => {
    const driftExecutor = new TestExecutor(
      createToolManifest({
        toolId: PRIVILEGED_TOOL_ID,
        actions: ["workspace.modify"],
      }),
    );
    const driftHarness = createHarness({
      executor: driftExecutor,
    });
    await expect(driftHarness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "manifest-mismatch",
      mayHaveExecuted: false,
    });
    expect(driftExecutor.executions).toHaveLength(0);

    const unavailableAudit: AuditTrail = {
      async append() {
        throw new PrivilegedServiceError("audit-unavailable", "Audit is unavailable");
      },
    };
    const auditExecutor = new TestExecutor();
    const auditHarness = createHarness({
      auditTrail: unavailableAudit,
      executor: auditExecutor,
    });
    await expect(auditHarness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "audit-unavailable",
      mayHaveExecuted: false,
    });
    expect(auditExecutor.executions).toHaveLength(0);
  });

  it("marks completion-audit failure as possibly executed and never retries", async () => {
    const auditClock = new TestClock();
    let auditSequence = 0;
    const recorded = new InMemoryAuditTrail(auditClock, () =>
      auditRecordId(`post-execution-audit-${String(++auditSequence)}`),
    );
    let appendCount = 0;
    const failCompletionAudit: AuditTrail = {
      async append(event) {
        appendCount += 1;
        if (appendCount === 3) {
          throw new PrivilegedServiceError("audit-unavailable", "Completion audit is unavailable");
        }
        return recorded.append(event);
      },
    };
    const executor = new TestExecutor();
    const harness = createHarness({
      auditTrail: failCompletionAudit,
      executor,
    });

    await expect(harness.gateway.invoke(createProtectedOperation())).rejects.toMatchObject({
      code: "post-execution-audit-failed",
      mayHaveExecuted: true,
    });
    expect(executor.executions).toHaveLength(1);
    expect(recorded.snapshot().map(({ event }) => event.type)).toEqual([
      "policy.evaluated",
      "tool.started",
    ]);
  });

  it("sanitizes executor failures, records only a code, and releases leases", async () => {
    const executor = new TestExecutor(
      createToolManifest({
        credentialUse: "required",
      }),
    );
    executor.failure = new Error("sensitive executor detail must not cross the gateway");
    const harness = createHarness({
      rules: [
        createPolicyRule({
          credentialUse: "required",
        }),
      ],
      executor,
    });

    await expect(
      harness.gateway.invoke(
        createProtectedOperation({
          credentialRefs: [PRIVILEGED_CREDENTIAL_REFERENCE],
        }),
      ),
    ).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      message: "Protected tool execution failed",
    });
    await expect(harness.credentialBroker.activeLeaseCount()).resolves.toBe(0);
    const encodedAudit = JSON.stringify((harness.auditTrail as InMemoryAuditTrail).snapshot());
    expect(encodedAudit).toContain('"errorCode":"executor-failed"');
    expect(encodedAudit).not.toContain("sensitive executor detail");
  });
});
