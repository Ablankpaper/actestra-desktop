import { randomUUID } from "node:crypto";
import {
  CODING_ARTIFACT_PUBLISH_TOOL_ID,
  CODING_DIFF_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
  PRIVILEGED_CONTRACT_VERSION,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  toolOutputReference,
  assertPersistWorkspaceGrantResult,
  assertWorkspaceGrant,
  instant,
  type ActestraPersistencePort,
  type ApprovalId,
  ApprovalService,
  AuditRecordId,
  AuthorizationGrantId,
  CredentialLeaseId,
  PolicyDecisionId,
  PrivilegedClock,
  ToolGateway,
  ToolOutputReference,
  type PolicyEngine,
  type PolicyRule,
  type PolicySnapshot,
  type ProtectedOperation,
  type ToolGatewayResult,
  type ToolInvocationControl,
  type WorkspaceGrant,
} from "../../core";
import type { IsolatedCodingWorktree } from "../workers/isolatedCodingWorktree";
import { ApprovalAuditEvidenceTrail } from "./approvalAuditEvidence";
import { DeterministicPolicyEngine } from "./deterministicPolicyEngine";
import { InMemoryApprovalService } from "./inMemoryApprovalService";
import { IsolatedCodingToolExecutor } from "./isolatedCodingToolExecutor";
import { PersistentAuditTrail } from "./persistentAuditTrail";
import { ReferenceCredentialBroker } from "./referenceCredentialBroker";
import { PrivilegedToolGateway } from "./toolGateway";

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;

export const ISOLATED_CODING_POLICY_REVISION = policyRevision("policy-p5-isolated-coding-v1");

export interface IsolatedCodingProcessDefinition {
  readonly executablePath: string;
  readonly args: readonly string[];
}

export interface IsolatedCodingToolPlatformIdSources {
  readonly newAuditRecordId: () => AuditRecordId;
  readonly newPolicyDecisionId: () => PolicyDecisionId;
  readonly newApprovalId: () => ApprovalId;
  readonly newAuthorizationGrantId: () => AuthorizationGrantId;
  readonly newCredentialLeaseId: () => CredentialLeaseId;
  readonly newOutputReference: () => ToolOutputReference;
}

export interface IsolatedCodingToolPlatformConfig {
  readonly persistence: ActestraPersistencePort;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  readonly clock: PrivilegedClock;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly identifiers?: IsolatedCodingToolPlatformIdSources;
}

export interface IsolatedCodingToolPlatform {
  readonly approvalService: ApprovalService;
  readonly approvalAuditEvidence: ApprovalAuditEvidenceTrail;
  readonly policyEngine: PolicyEngine;
  readonly executor: IsolatedCodingToolExecutor;
  readonly toolGateway: ToolGateway;
  readonly persistence: ActestraPersistencePort;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
}

export type IsolatedCodingToolLifecycleErrorCode = "invalid-config" | "closed" | "cleanup-failed";

export class IsolatedCodingToolLifecycleError extends Error {
  constructor(
    readonly code: IsolatedCodingToolLifecycleErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IsolatedCodingToolLifecycleError";
  }
}

export interface ManageIsolatedCodingToolPlatformConfig {
  readonly platform: IsolatedCodingToolPlatform;
  readonly persistence: ActestraPersistencePort;
  readonly worktree: IsolatedCodingWorktree;
  readonly grant: WorkspaceGrant;
  readonly clock: PrivilegedClock;
}

export interface ManagedIsolatedCodingToolPlatform {
  readonly approvalService: ApprovalService;
  readonly approvalAuditEvidence: ApprovalAuditEvidenceTrail;
  readonly policyEngine: PolicyEngine;
  readonly toolGateway: ToolGateway;
  readonly grant: WorkspaceGrant;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  close(): Promise<void>;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function defaultIdentifiers(): IsolatedCodingToolPlatformIdSources {
  return {
    newAuditRecordId: () => auditRecordId(identifier("audit-record")),
    newPolicyDecisionId: () => policyDecisionId(identifier("policy-decision")),
    newApprovalId: () => approvalId(identifier("approval")),
    newAuthorizationGrantId: () => authorizationGrantId(identifier("authorization-grant")),
    newCredentialLeaseId: () => credentialLeaseId(identifier("credential-lease")),
    newOutputReference: () => toolOutputReference(identifier("coding-tool-output")),
  };
}

export function isolatedCodingPolicySnapshot(): PolicySnapshot {
  const rules = Object.freeze([
    Object.freeze({
      id: policyRuleId("rule-p5-coding-file-read"),
      effect: "allow",
      actions: Object.freeze(["workspace.read"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_FILE_READ_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-file-write-approval"),
      effect: "require-approval",
      actions: Object.freeze(["workspace.modify"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_FILE_WRITE_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-terminal-approval"),
      effect: "require-approval",
      actions: Object.freeze(["shell.execute"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_TERMINAL_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-git-inspect"),
      effect: "allow",
      actions: Object.freeze(["tool.invoke"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_GIT_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-diff-inspect"),
      effect: "allow",
      actions: Object.freeze(["workspace.read"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_DIFF_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-test-approval"),
      effect: "require-approval",
      actions: Object.freeze(["shell.execute"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_TEST_TOOL_ID]),
    } satisfies PolicyRule),
    Object.freeze({
      id: policyRuleId("rule-p5-coding-artifact-publish-approval"),
      effect: "require-approval",
      actions: Object.freeze(["publish.execute"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([CODING_ARTIFACT_PUBLISH_TOOL_ID]),
    } satisfies PolicyRule),
  ]);
  return Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    revision: ISOLATED_CODING_POLICY_REVISION,
    rules,
  });
}

function isInvocationControl(value: ToolInvocationControl | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).some((key) => key !== "signal")
  ) {
    return false;
  }
  const signal = value.signal;
  return (
    signal === undefined ||
    (typeof signal === "object" &&
      signal !== null &&
      typeof signal.aborted === "boolean" &&
      typeof signal.addEventListener === "function" &&
      typeof signal.removeEventListener === "function")
  );
}

class LifecycleToolGateway implements ToolGateway {
  private accepting = true;
  private readonly controllers = new Set<AbortController>();
  private readonly invocations = new Set<Promise<ToolGatewayResult>>();

  constructor(private readonly delegate: ToolGateway) {}

  invoke(
    operation: ProtectedOperation,
    approval?: ApprovalId,
    control?: ToolInvocationControl,
  ): Promise<ToolGatewayResult> {
    if (!this.accepting) {
      return Promise.reject(
        new IsolatedCodingToolLifecycleError(
          "closed",
          "Isolated coding tools cannot start after lifecycle cleanup begins",
        ),
      );
    }

    if (!isInvocationControl(control)) {
      return this.track(this.delegate.invoke(operation, approval, control));
    }

    const controller = new AbortController();
    const externalSignal = control?.signal;
    const abortFromExternal = (): void => {
      controller.abort(externalSignal?.reason ?? "coding-tool-cancelled");
    };
    if (externalSignal?.aborted) {
      abortFromExternal();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    }
    this.controllers.add(controller);
    return this.track(
      this.delegate.invoke(operation, approval, { signal: controller.signal }),
      () => {
        externalSignal?.removeEventListener("abort", abortFromExternal);
        this.controllers.delete(controller);
      },
    );
  }

  async stop(): Promise<void> {
    this.accepting = false;
    for (const controller of this.controllers) {
      controller.abort("isolated-coding-lifecycle-closing");
    }
    await Promise.allSettled(this.invocations);
  }

  private track(
    invocation: Promise<ToolGatewayResult>,
    cleanup?: () => void,
  ): Promise<ToolGatewayResult> {
    let tracked: Promise<ToolGatewayResult>;
    tracked = invocation.finally(() => {
      cleanup?.();
      this.invocations.delete(tracked);
    });
    this.invocations.add(tracked);
    return tracked;
  }
}

export function manageIsolatedCodingToolPlatform(
  config: ManageIsolatedCodingToolPlatformConfig,
): ManagedIsolatedCodingToolPlatform {
  try {
    assertWorkspaceGrant(config.grant);
    instant(config.clock.now());
  } catch (error) {
    throw new IsolatedCodingToolLifecycleError(
      "invalid-config",
      "Isolated coding lifecycle configuration is invalid",
      { cause: error },
    );
  }
  if (
    config.grant.state !== "active" ||
    config.grant.rootPath !== config.worktree.worktreeRoot ||
    config.worktree.repositoryRoot === config.worktree.worktreeRoot ||
    config.platform.persistence !== config.persistence ||
    config.platform.repositoryRoot !== config.worktree.repositoryRoot ||
    config.platform.worktreeRoot !== config.worktree.worktreeRoot ||
    config.platform.gitDirectory !== config.worktree.gitDirectory ||
    config.platform.gitCommonDirectory !== config.worktree.gitCommonDirectory
  ) {
    throw new IsolatedCodingToolLifecycleError(
      "invalid-config",
      "Isolated coding lifecycle requires one exact active worktree grant",
    );
  }

  const grant = Object.freeze({ ...config.grant });
  const gateway = new LifecycleToolGateway(config.platform.toolGateway);
  let grantRevoked = false;
  let revocationGrant: WorkspaceGrant | undefined;
  let worktreeRemoved = false;
  let closePromise: Promise<void> | undefined;

  const closeOnce = async (): Promise<void> => {
    await gateway.stop();
    if (!grantRevoked) {
      const revokedGrant =
        revocationGrant ??
        (Object.freeze({
          ...grant,
          state: "revoked",
          updatedAt: config.clock.now(),
        }) satisfies WorkspaceGrant);
      instant(revokedGrant.updatedAt);
      revocationGrant = revokedGrant;
      const result = await config.persistence.persistWorkspaceGrant(revokedGrant);
      assertPersistWorkspaceGrantResult(result);
      if (
        result.grant.contractVersion !== revokedGrant.contractVersion ||
        result.grant.grantId !== revokedGrant.grantId ||
        result.grant.workspaceId !== revokedGrant.workspaceId ||
        result.grant.rootPath !== revokedGrant.rootPath ||
        result.grant.displayName !== revokedGrant.displayName ||
        result.grant.state !== revokedGrant.state ||
        result.grant.createdAt !== revokedGrant.createdAt ||
        result.grant.updatedAt !== revokedGrant.updatedAt
      ) {
        throw new IsolatedCodingToolLifecycleError(
          "cleanup-failed",
          "Workspace grant revocation returned mismatched evidence",
        );
      }
      grantRevoked = true;
    }
    if (!worktreeRemoved) {
      await config.worktree.close();
      worktreeRemoved = true;
    }
  };

  return Object.freeze({
    approvalService: config.platform.approvalService,
    approvalAuditEvidence: config.platform.approvalAuditEvidence,
    policyEngine: config.platform.policyEngine,
    toolGateway: gateway,
    grant,
    repositoryRoot: config.worktree.repositoryRoot,
    worktreeRoot: config.worktree.worktreeRoot,
    gitDirectory: config.worktree.gitDirectory,
    gitCommonDirectory: config.worktree.gitCommonDirectory,
    close(): Promise<void> {
      if (worktreeRemoved) {
        return Promise.resolve();
      }
      closePromise ??= closeOnce().catch((error: unknown) => {
        closePromise = undefined;
        if (error instanceof IsolatedCodingToolLifecycleError) {
          throw error;
        }
        throw new IsolatedCodingToolLifecycleError(
          "cleanup-failed",
          "Isolated coding grant or worktree cleanup failed",
          { cause: error },
        );
      });
      return closePromise;
    },
  });
}

export function createIsolatedCodingToolPlatform(
  config: IsolatedCodingToolPlatformConfig,
): IsolatedCodingToolPlatform {
  const identifiers = config.identifiers ?? defaultIdentifiers();
  const persistentAuditTrail = new PersistentAuditTrail({
    clock: config.clock,
    persistence: config.persistence,
    newRecordId: identifiers.newAuditRecordId,
  });
  const auditTrail = new ApprovalAuditEvidenceTrail(persistentAuditTrail);
  const policyEngine = new DeterministicPolicyEngine(
    isolatedCodingPolicySnapshot(),
    config.clock,
    identifiers.newPolicyDecisionId,
  );
  const approvalService = new InMemoryApprovalService({
    clock: config.clock,
    auditTrail,
    ttlMs: APPROVAL_TTL_MS,
    newApprovalId: identifiers.newApprovalId,
    newGrantId: identifiers.newAuthorizationGrantId,
  });
  const credentialBroker = new ReferenceCredentialBroker({
    clock: config.clock,
    auditTrail,
    leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
    historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
    newLeaseId: identifiers.newCredentialLeaseId,
  });
  const executor = new IsolatedCodingToolExecutor({
    persistence: config.persistence,
    repositoryRoot: config.repositoryRoot,
    worktreeRoot: config.worktreeRoot,
    gitDirectory: config.gitDirectory,
    gitCommonDirectory: config.gitCommonDirectory,
    clock: config.clock,
    commands: config.commands,
    tests: config.tests,
    newOutputReference: identifiers.newOutputReference,
  });
  const toolGateway = new PrivilegedToolGateway({
    policyEngine,
    approvalService,
    credentialBroker,
    auditTrail,
    executor,
  });
  return Object.freeze({
    approvalService,
    approvalAuditEvidence: auditTrail,
    policyEngine,
    executor,
    toolGateway,
    persistence: config.persistence,
    repositoryRoot: config.repositoryRoot,
    worktreeRoot: config.worktreeRoot,
    gitDirectory: config.gitDirectory,
    gitCommonDirectory: config.gitCommonDirectory,
  });
}
