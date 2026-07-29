import { isDeepStrictEqual } from "node:util";
import {
  ProtectedToolExecutionError,
  PrivilegedServiceError,
  approvalId,
  assertAuditRecord,
  assertAuthorizationResult,
  assertCredentialLease,
  assertPolicyDecision,
  assertProtectedOperation,
  assertToolCapabilityManifest,
  assertToolExecutionResult,
  auditContextFor,
  authorizationMatchesOperation,
  compareInstants,
  protectedOperationsEqual,
  type ApprovalId,
  type ApprovalRequestSnapshot,
  type ApprovalService,
  type AuditEvent,
  type AuditTrail,
  type AuthorizationGrant,
  type CredentialBroker,
  type CredentialLease,
  type PolicyDecision,
  type PolicyEngine,
  type ProtectedOperation,
  type ProtectedToolExecutor,
  type ToolCapabilityManifest,
  type ToolExecutionResult,
  type ToolGateway,
  type ToolGatewayResult,
  type ToolInvocationControl,
} from "../../core";

export interface PrivilegedToolGatewayConfig {
  readonly policyEngine: PolicyEngine;
  readonly approvalService: ApprovalService;
  readonly credentialBroker: CredentialBroker;
  readonly auditTrail: AuditTrail;
  readonly executor: ProtectedToolExecutor;
}

function assertManifestMatchesOperation(
  manifest: ToolCapabilityManifest,
  operation: ProtectedOperation,
): void {
  const usesCredentials = operation.credentialRefs.length > 0;
  const credentialMismatch =
    (manifest.credentialUse === "forbidden" && usesCredentials) ||
    (manifest.credentialUse === "required" && !usesCredentials);

  if (
    manifest.toolId !== operation.toolId ||
    !manifest.actions.includes(operation.action) ||
    !manifest.resourceKinds.includes(operation.resourceKind) ||
    credentialMismatch
  ) {
    throw new PrivilegedServiceError(
      "manifest-mismatch",
      "Protected operation exceeds the registered tool capability manifest",
    );
  }
}

function immutableOperation(operation: ProtectedOperation): ProtectedOperation {
  return Object.freeze({
    ...operation,
    credentialRefs: Object.freeze([...operation.credentialRefs]),
  });
}

function immutableManifest(manifest: ToolCapabilityManifest): ToolCapabilityManifest {
  return Object.freeze({
    ...manifest,
    actions: Object.freeze([...manifest.actions]),
    resourceKinds: Object.freeze([...manifest.resourceKinds]),
  });
}

function immutableDecision(decision: PolicyDecision): PolicyDecision {
  return Object.freeze({
    ...decision,
    matchedRuleIds: Object.freeze([...decision.matchedRuleIds]),
  });
}

function immutableApproval(approval: ApprovalRequestSnapshot): ApprovalRequestSnapshot {
  return Object.freeze({
    ...approval,
    operation: immutableOperation(approval.operation),
  });
}

function immutableAuthorization(authorization: AuthorizationGrant): AuthorizationGrant {
  return Object.freeze({
    ...authorization,
    credentialRefs: Object.freeze([...authorization.credentialRefs]),
  });
}

export class PrivilegedToolGateway implements ToolGateway {
  constructor(private readonly config: PrivilegedToolGatewayConfig) {}

  async invoke(
    operation: ProtectedOperation,
    approval?: ApprovalId,
    control?: ToolInvocationControl,
  ): Promise<ToolGatewayResult> {
    assertProtectedOperation(operation);
    const stableOperation = immutableOperation(operation);
    if (approval !== undefined) {
      approvalId(approval);
    }
    this.assertControl(control);
    const manifest = await this.loadManifest(stableOperation);
    const decision = await this.evaluatePolicy(stableOperation);
    await this.appendAudit(
      {
        type: "policy.evaluated",
        context: auditContextFor(stableOperation),
        policyRevision: decision.policyRevision,
        decision: decision.effect,
        reasonCode: decision.reasonCode,
        matchedRuleIds: decision.matchedRuleIds,
      },
      false,
    );

    if (decision.effect === "deny") {
      throw new PrivilegedServiceError("policy-denied", "Policy denied the protected operation");
    }

    const authorizationResult = await this.config.approvalService.authorize(
      stableOperation,
      decision,
      approval,
    );
    assertAuthorizationResult(authorizationResult);
    if (authorizationResult.status === "approval-required") {
      if (
        decision.effect !== "require-approval" ||
        authorizationResult.approval.policyRevision !== decision.policyRevision ||
        !protectedOperationsEqual(authorizationResult.approval.operation, stableOperation)
      ) {
        throw new PrivilegedServiceError(
          "approval-mismatch",
          "Approval service returned evidence for a different operation or policy",
        );
      }
      return Object.freeze({
        status: "approval-required",
        decision,
        approval: immutableApproval(authorizationResult.approval),
      });
    }

    const authorization = immutableAuthorization(authorizationResult.authorization);
    const expectedMethod = decision.effect === "allow" ? "policy" : "approval";
    if (
      !authorizationMatchesOperation(authorization, stableOperation) ||
      authorization.policyDecisionId !== decision.decisionId ||
      authorization.policyRevision !== decision.policyRevision ||
      authorization.method !== expectedMethod ||
      (expectedMethod === "approval" && authorization.approvalId !== approval)
    ) {
      throw new PrivilegedServiceError(
        "approval-mismatch",
        "Authorization grant does not match the current operation and policy",
      );
    }
    const leases = await this.issueLeases(stableOperation, authorization);
    try {
      await this.appendAudit(
        {
          type: "tool.started",
          context: auditContextFor(stableOperation),
          authorizationMethod: authorization.method,
          ...(authorization.approvalId === undefined
            ? {}
            : {
                approvalId: authorization.approvalId,
              }),
        },
        false,
      );
    } catch (error) {
      await this.releaseBeforeExecution(stableOperation, leases);
      throw error;
    }

    return this.execute(
      stableOperation,
      manifest,
      decision,
      authorization,
      leases,
      control?.signal,
    );
  }

  private async loadManifest(operation: ProtectedOperation): Promise<ToolCapabilityManifest> {
    let manifest: ToolCapabilityManifest;
    try {
      manifest = await this.config.executor.manifest(operation.toolId);
    } catch {
      throw new PrivilegedServiceError(
        "manifest-unavailable",
        "Tool capability manifest is unavailable",
      );
    }
    assertToolCapabilityManifest(manifest);
    const stableManifest = immutableManifest(manifest);
    assertManifestMatchesOperation(stableManifest, operation);
    return stableManifest;
  }

  private async evaluatePolicy(operation: ProtectedOperation): Promise<PolicyDecision> {
    let decision: PolicyDecision;
    try {
      decision = await this.config.policyEngine.evaluate(operation);
      assertPolicyDecision(decision);
    } catch (error) {
      if (error instanceof PrivilegedServiceError && error.code === "invalid-contract") {
        throw error;
      }
      throw new PrivilegedServiceError("policy-unavailable", "Policy decision is unavailable");
    }
    if (decision.requestId !== operation.requestId) {
      throw new PrivilegedServiceError(
        "policy-unavailable",
        "Policy decision does not match the protected operation",
      );
    }
    return immutableDecision(decision);
  }

  private async issueLeases(
    operation: ProtectedOperation,
    authorization: Parameters<CredentialBroker["lease"]>[1],
  ): Promise<readonly CredentialLease[]> {
    try {
      const value = await this.config.credentialBroker.lease(operation, authorization);
      if (!Array.isArray(value)) {
        throw new PrivilegedServiceError(
          "credential-unavailable",
          "Credential broker returned an invalid lease collection",
        );
      }
      value.forEach(assertCredentialLease);
      if (
        value.length !== operation.credentialRefs.length ||
        value.some(
          (lease, index) =>
            lease.credentialRef !== operation.credentialRefs[index] ||
            lease.requestId !== operation.requestId ||
            lease.authorizationGrantId !== authorization.grantId ||
            compareInstants(lease.issuedAt, authorization.issuedAt) < 0,
        ) ||
        new Set(value.map(({ leaseId }) => leaseId)).size !== value.length
      ) {
        throw new PrivilegedServiceError(
          "credential-unavailable",
          "Credential leases do not match the authorized operation",
        );
      }
      return Object.freeze(
        value.map((lease) =>
          Object.freeze({
            ...lease,
          }),
        ),
      );
    } catch (error) {
      if (error instanceof PrivilegedServiceError) {
        throw error;
      }
      throw new PrivilegedServiceError(
        "credential-unavailable",
        "Credential lease references are unavailable",
      );
    }
  }

  private async execute(
    operation: ProtectedOperation,
    manifest: ToolCapabilityManifest,
    decision: PolicyDecision,
    authorization: Parameters<CredentialBroker["lease"]>[1],
    leases: readonly CredentialLease[],
    signal?: AbortSignal,
  ): Promise<ToolGatewayResult> {
    let result: ToolExecutionResult;
    try {
      result = await this.config.executor.execute({
        operation,
        authorization,
        credentialLeases: leases,
        timeoutMs: manifest.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
      assertToolExecutionResult(result);
    } catch (error) {
      const executionError =
        error instanceof ProtectedToolExecutionError
          ? error
          : new ProtectedToolExecutionError("executor-failed", "Protected tool executor failed", {
              cause: error,
              mayHaveExecuted: true,
            });
      try {
        await this.appendAudit(
          {
            type: "tool.failed",
            context: auditContextFor(operation),
            errorCode: executionError.errorCode,
          },
          executionError.mayHaveExecuted,
        );
      } catch (auditError) {
        await this.releaseAfterExecution(operation, leases);
        throw auditError;
      }
      await this.releaseAfterExecution(operation, leases);
      throw new PrivilegedServiceError("tool-execution-failed", "Protected tool execution failed", {
        cause: executionError,
        mayHaveExecuted: executionError.mayHaveExecuted,
      });
    }

    try {
      await this.appendAudit(
        {
          type: "tool.completed",
          context: auditContextFor(operation),
          ...(result.outputRef === undefined ? {} : { outputRef: result.outputRef }),
        },
        true,
      );
    } catch (error) {
      await this.releaseAfterExecution(operation, leases);
      throw error;
    }
    await this.releaseAfterExecution(operation, leases);
    return Object.freeze({
      status: "executed",
      decision,
      authorization,
      result: Object.freeze({ ...result }),
    });
  }

  private async appendAudit(event: AuditEvent, mayHaveExecuted: boolean): Promise<void> {
    try {
      const record = await this.config.auditTrail.append(event);
      assertAuditRecord(record);
      if (!isDeepStrictEqual(record.event, event)) {
        throw new PrivilegedServiceError(
          "audit-unavailable",
          "Audit trail acknowledged a different event",
        );
      }
    } catch {
      throw new PrivilegedServiceError(
        mayHaveExecuted ? "post-execution-audit-failed" : "audit-unavailable",
        mayHaveExecuted
          ? "Tool outcome audit failed after execution may have started"
          : "Required pre-execution audit evidence is unavailable",
        {
          mayHaveExecuted,
        },
      );
    }
  }

  private assertControl(control: ToolInvocationControl | undefined): void {
    if (control === undefined) {
      return;
    }
    if (
      typeof control !== "object" ||
      control === null ||
      Array.isArray(control) ||
      Object.keys(control).some((key) => key !== "signal")
    ) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Tool invocation control must contain only an optional abort signal",
      );
    }
    const signal = control.signal;
    if (
      signal !== undefined &&
      (typeof signal !== "object" ||
        signal === null ||
        typeof signal.aborted !== "boolean" ||
        typeof signal.addEventListener !== "function" ||
        typeof signal.removeEventListener !== "function")
    ) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Tool invocation control.signal must be an AbortSignal",
      );
    }
  }

  private async releaseBeforeExecution(
    operation: ProtectedOperation,
    leases: readonly CredentialLease[],
  ): Promise<void> {
    try {
      await this.config.credentialBroker.release(operation, leases);
    } catch {
      throw new PrivilegedServiceError(
        "credential-release-failed",
        "Credential leases could not be released before execution",
      );
    }
  }

  private async releaseAfterExecution(
    operation: ProtectedOperation,
    leases: readonly CredentialLease[],
  ): Promise<void> {
    try {
      await this.config.credentialBroker.release(operation, leases);
    } catch {
      throw new PrivilegedServiceError(
        "credential-release-failed",
        "Credential leases could not be released after execution may have started",
        {
          mayHaveExecuted: true,
        },
      );
    }
  }
}
