import { randomUUID } from "node:crypto";
import {
  PRIVILEGED_CONTRACT_VERSION,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  instant,
  policyDecisionId,
  policyRevision,
  type ApprovalService,
  type AuditRecordId,
  type AuditTrail,
  type CredentialBroker,
  type PolicyEngine,
  type PolicySnapshot,
  type PrivilegedClock,
  type ToolGateway,
} from "../../core";
import {
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  assertPlatformSnapshot,
  type PlatformAttemptProjection,
  type PlatformSnapshot,
} from "../../shared/contracts";
import {
  openSqliteCorePersistence,
  type ActestraPersistencePort,
} from "../persistence/sqliteCorePersistence";
import { DeterministicPolicyEngine } from "../privileged/deterministicPolicyEngine";
import { DisabledProtectedToolExecutor } from "../privileged/disabledProtectedToolExecutor";
import { InMemoryApprovalService } from "../privileged/inMemoryApprovalService";
import { PersistentAuditTrail } from "../privileged/persistentAuditTrail";
import { ReferenceCredentialBroker } from "../privileged/referenceCredentialBroker";
import { PrivilegedToolGateway } from "../privileged/toolGateway";
import { AgentAdapterSupervisor } from "../workers/agentAdapterSupervisor";
import { AgentAttemptEvidenceCoordinator } from "../workers/agentAttemptEvidenceCoordinator";

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const CREDENTIAL_LEASE_TTL_MS = 30 * 1_000;
const CREDENTIAL_HISTORY_RETENTION_MS = 5 * 60 * 1_000;
const PLATFORM_ATTEMPT_LIMIT = 50;

class SystemPrivilegedClock implements PrivilegedClock {
  now() {
    return instant(new Date().toISOString());
  }
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function projectionForAttempt(
  evidence: Awaited<ReturnType<ActestraPersistencePort["listRecentAgentAttemptEvidence"]>>[number],
): PlatformAttemptProjection {
  return Object.freeze({
    sessionId: evidence.sessionId,
    workerId: evidence.workerId,
    state: evidence.state,
    ...(evidence.taskState === undefined ? {} : { taskState: evidence.taskState }),
    lastCoreEventSequence: evidence.lastCoreEventSequence,
    forcedCancellation: evidence.forcedCancellation,
    ...(evidence.incident === undefined ? {} : { incidentCode: evidence.incident.code }),
  });
}

export class MainPlatformServices {
  readonly auditTrail: AuditTrail;
  readonly policyEngine: PolicyEngine;
  readonly approvalService: ApprovalService;
  readonly credentialBroker: CredentialBroker;
  readonly toolGateway: ToolGateway;
  private closed = false;

  constructor(private readonly persistence: ActestraPersistencePort) {
    const clock = new SystemPrivilegedClock();
    this.auditTrail = new PersistentAuditTrail({
      clock,
      persistence,
      newRecordId: (): AuditRecordId => auditRecordId(identifier("audit-record")),
    });
    const denyByDefaultPolicy = Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      revision: policyRevision("policy-main-deny-by-default-v1"),
      rules: Object.freeze([]),
    }) satisfies PolicySnapshot;
    this.policyEngine = new DeterministicPolicyEngine(denyByDefaultPolicy, clock, () =>
      policyDecisionId(identifier("policy-decision")),
    );
    this.approvalService = new InMemoryApprovalService({
      clock,
      auditTrail: this.auditTrail,
      ttlMs: APPROVAL_TTL_MS,
      newApprovalId: () => approvalId(identifier("approval")),
      newGrantId: () => authorizationGrantId(identifier("authorization-grant")),
    });
    this.credentialBroker = new ReferenceCredentialBroker({
      clock,
      auditTrail: this.auditTrail,
      leaseTtlMs: CREDENTIAL_LEASE_TTL_MS,
      historyRetentionMs: CREDENTIAL_HISTORY_RETENTION_MS,
      newLeaseId: () => credentialLeaseId(identifier("credential-lease")),
    });
    this.toolGateway = new PrivilegedToolGateway({
      policyEngine: this.policyEngine,
      approvalService: this.approvalService,
      credentialBroker: this.credentialBroker,
      auditTrail: this.auditTrail,
      executor: new DisabledProtectedToolExecutor(),
    });
  }

  async snapshot(): Promise<PlatformSnapshot> {
    this.assertOpen();
    const [audit, attempts] = await Promise.all([
      this.persistence.summarizePrivilegedAudit(),
      this.persistence.listRecentAgentAttemptEvidence(PLATFORM_ATTEMPT_LIMIT),
    ]);
    const snapshot = Object.freeze({
      contractVersion: PLATFORM_SNAPSHOT_CONTRACT_VERSION,
      authority: "main-only",
      privilegedServices: "registered-inert",
      policy: "deny-by-default",
      credentials: "opaque-references-only",
      tools: "disabled",
      audit: Object.freeze({
        durability: "sqlite-metadata-only",
        recordCount: audit.recordCount,
        lastSequence: audit.lastSequence,
      }),
      attempts: Object.freeze(attempts.map(projectionForAttempt)),
    }) satisfies PlatformSnapshot;
    assertPlatformSnapshot(snapshot);
    return snapshot;
  }

  createAttemptEvidenceCoordinator(
    supervisor: AgentAdapterSupervisor,
  ): AgentAttemptEvidenceCoordinator {
    this.assertOpen();
    return new AgentAttemptEvidenceCoordinator({
      supervisor,
      corePersistence: this.persistence,
      evidencePersistence: this.persistence,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.persistence.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Actestra main platform services are closed");
    }
  }
}

export function createMainPlatformServices(userDataPath: string): MainPlatformServices {
  const persistence = openSqliteCorePersistence(userDataPath);
  try {
    return new MainPlatformServices(persistence);
  } catch (error) {
    void persistence.close().catch(() => undefined);
    throw error;
  }
}
