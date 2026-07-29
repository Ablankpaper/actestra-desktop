import {
  type ActestraPersistencePort,
  type ApprovalService,
  type AuditTrail,
  type CredentialBroker,
  type PolicyEngine,
  type ToolGateway,
} from "../../core";
import {
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  assertPlatformSnapshot,
  type PlatformAttemptProjection,
  type PlatformSnapshot,
} from "../../shared/contracts";
import {
  ScopedNativeToolPlatform,
  createScopedNativeToolPlatform,
} from "../privileged/scopedNativeToolPlatform";
import { AgentAdapterSupervisor } from "../workers/agentAdapterSupervisor";
import { AgentAttemptEvidenceCoordinator } from "../workers/agentAttemptEvidenceCoordinator";
import {
  GeneralWorkCoordinator,
  type GeneralWorkRecoveryResult,
} from "../workers/generalWorkCoordinator";
import { ScopedNativeToolCoordinator } from "../workers/scopedNativeToolCoordinator";

const PLATFORM_ATTEMPT_LIMIT = 50;

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
  readonly nativeTools: ScopedNativeToolPlatform;
  private closed = false;

  constructor(private readonly persistence: ActestraPersistencePort) {
    this.nativeTools = createScopedNativeToolPlatform({ persistence });
    this.auditTrail = this.nativeTools.auditTrail;
    this.policyEngine = this.nativeTools.policyEngine;
    this.approvalService = this.nativeTools.approvalService;
    this.credentialBroker = this.nativeTools.credentialBroker;
    this.toolGateway = this.nativeTools.toolGateway;
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
      privilegedServices: "scoped-native-active",
      policy: "deny-by-default",
      credentials: "opaque-references-only",
      tools: "workspace-read-task-output-create",
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

  createScopedNativeToolCoordinator(
    supervisor: AgentAdapterSupervisor,
  ): ScopedNativeToolCoordinator {
    this.assertOpen();
    return this.nativeTools.createCoordinator(supervisor);
  }

  createGeneralWorkCoordinator(supervisor: AgentAdapterSupervisor): GeneralWorkCoordinator {
    this.assertOpen();
    return new GeneralWorkCoordinator({
      persistence: this.persistence,
      clock: this.nativeTools.clock,
      supervisor,
      nativeTools: this.nativeTools,
    });
  }

  async recoverGeneralWork(): Promise<readonly GeneralWorkRecoveryResult[]> {
    this.assertOpen();
    return new GeneralWorkCoordinator({
      persistence: this.persistence,
      clock: this.nativeTools.clock,
    }).recover();
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

export function createMainPlatformServices(
  persistence: ActestraPersistencePort,
): MainPlatformServices {
  try {
    return new MainPlatformServices(persistence);
  } catch (error) {
    void persistence.close().catch(() => undefined);
    throw error;
  }
}
