import { randomUUID } from "node:crypto";
import {
  ARTIFACT_APPLY_TOOL_DEFINITION,
  ARTIFACT_APPLY_TOOL_ID,
  PRIVILEGED_CONTRACT_VERSION,
  ProtectedToolExecutionError,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  toolId,
  type ActestraPersistencePort,
  type ApprovalService,
  type AuditRecordId,
  type ApprovalId,
  type AuthorizationGrantId,
  type PolicyDecisionId,
  type PolicyEngine,
  type PolicyRule,
  type PolicySnapshot,
  type PrivilegedClock,
  type ToolCapabilityManifest,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolGateway,
  type ToolId,
  type ProtectedToolExecutor,
} from "../../core";
import { ApprovalAuditEvidenceTrail } from "./approvalAuditEvidence";
import { DeterministicPolicyEngine } from "./deterministicPolicyEngine";
import { InMemoryApprovalService } from "./inMemoryApprovalService";
import { PersistentAuditTrail } from "./persistentAuditTrail";
import { ReferenceCredentialBroker } from "./referenceCredentialBroker";
import { PrivilegedToolGateway } from "./toolGateway";

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;

export const ARTIFACT_DELIVERY_POLICY_REVISION = policyRevision("policy-p5-artifact-delivery-v1");

/**
 * The delivery platform admits exactly one protected effect: applying a reviewed patch to the
 * original workspace, behind a user decision. Nothing else is reachable, so obtaining a gateway for
 * an apply can never also grant the caller a coding tool.
 */
export function artifactDeliveryPolicySnapshot(): PolicySnapshot {
  const rules = Object.freeze([
    Object.freeze({
      id: policyRuleId("rule-p5-artifact-apply-approval"),
      effect: "require-approval",
      actions: Object.freeze(["artifact.apply"]),
      resourceKinds: Object.freeze(["repository"]),
      credentialUse: "none",
      toolIds: Object.freeze([ARTIFACT_APPLY_TOOL_ID]),
    } satisfies PolicyRule),
  ]);
  return Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    revision: ARTIFACT_DELIVERY_POLICY_REVISION,
    rules,
  });
}

/**
 * Resolves the apply manifest and refuses to execute anything. The gateway needs a manifest to reach
 * the `require-approval` rule, but the patch is written by the applicator itself after the user
 * decides, so a gateway-driven execution would be a second, unaudited write path.
 */
class ArtifactDeliveryExecutor implements ProtectedToolExecutor {
  private readonly manifests: ReadonlyMap<ToolId, ToolCapabilityManifest>;

  constructor() {
    this.manifests = new Map([
      [
        ARTIFACT_APPLY_TOOL_DEFINITION.toolId,
        Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          toolId: ARTIFACT_APPLY_TOOL_DEFINITION.toolId,
          actions: Object.freeze([ARTIFACT_APPLY_TOOL_DEFINITION.action]),
          resourceKinds: Object.freeze([ARTIFACT_APPLY_TOOL_DEFINITION.resourceKind]),
          credentialUse: "forbidden",
          timeoutMs: ARTIFACT_APPLY_TOOL_DEFINITION.timeoutMs,
        } satisfies ToolCapabilityManifest),
      ],
    ]);
  }

  async manifest(requestedTool: ToolId): Promise<ToolCapabilityManifest> {
    toolId(requestedTool);
    const manifest = this.manifests.get(requestedTool);
    if (manifest === undefined) {
      throw new ProtectedToolExecutionError(
        "unsupported-tool",
        "Artifact delivery exposes no such tool",
      );
    }
    return manifest;
  }

  async execute(_request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    throw new ProtectedToolExecutionError(
      "unsupported-tool",
      "Artifact apply is performed by Main, not through gateway execution",
      { mayHaveExecuted: false },
    );
  }
}

export interface ArtifactDeliveryPlatformIdSources {
  readonly newAuditRecordId: () => AuditRecordId;
  readonly newPolicyDecisionId: () => PolicyDecisionId;
  readonly newApprovalId: () => ApprovalId;
  readonly newAuthorizationGrantId: () => AuthorizationGrantId;
}

export interface ArtifactDeliveryPlatformConfig {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly identifiers?: ArtifactDeliveryPlatformIdSources;
}

export interface ArtifactDeliveryPlatform {
  readonly approvalService: ApprovalService;
  readonly policyEngine: PolicyEngine;
  readonly toolGateway: ToolGateway;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function defaultIdentifiers(): ArtifactDeliveryPlatformIdSources {
  return {
    newAuditRecordId: () => auditRecordId(identifier("audit-record")),
    newPolicyDecisionId: () => policyDecisionId(identifier("policy-decision")),
    newApprovalId: () => approvalId(identifier("approval")),
    newAuthorizationGrantId: () => authorizationGrantId(identifier("authorization-grant")),
  };
}

/**
 * Builds the privileged services an apply needs without opening an isolated worktree. Reusing the
 * coding platform for this would create a fresh worktree and rebind the passed grant to it, so the
 * approval would name a throwaway copy while the write targeted the user's own repository.
 */
export function createArtifactDeliveryPlatform(
  config: ArtifactDeliveryPlatformConfig,
): ArtifactDeliveryPlatform {
  const identifiers = config.identifiers ?? defaultIdentifiers();
  const auditTrail = new ApprovalAuditEvidenceTrail(
    new PersistentAuditTrail({
      clock: config.clock,
      persistence: config.persistence,
      newRecordId: identifiers.newAuditRecordId,
    }),
  );
  const policyEngine = new DeterministicPolicyEngine(
    artifactDeliveryPolicySnapshot(),
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
  const toolGateway = new PrivilegedToolGateway({
    policyEngine,
    approvalService,
    credentialBroker: new ReferenceCredentialBroker({
      clock: config.clock,
      auditTrail,
      leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
      historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
      newLeaseId: () => {
        throw new ProtectedToolExecutionError(
          "unsupported-tool",
          "Artifact apply never leases credentials",
        );
      },
    }),
    auditTrail,
    executor: new ArtifactDeliveryExecutor(),
  });
  return Object.freeze({
    approvalService,
    policyEngine,
    toolGateway,
  });
}
