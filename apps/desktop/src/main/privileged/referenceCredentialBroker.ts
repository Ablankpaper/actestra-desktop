import { isDeepStrictEqual } from "node:util";
import {
  PrivilegedServiceError,
  assertAuditRecord,
  assertAuthorizationGrant,
  assertCredentialLease,
  assertProtectedOperation,
  auditContextFor,
  authorizationMatchesOperation,
  compareInstants,
  credentialLeaseId,
  instant,
  protectedOperationsEqual,
  type AuditTrail,
  type AuthorizationGrant,
  type CredentialBroker,
  type CredentialLease,
  type CredentialLeaseId,
  type PrivilegedClock,
  type ProtectedOperation,
} from "../../core";

interface ActiveLease {
  readonly operation: ProtectedOperation;
  readonly lease: CredentialLease;
}

export interface ReferenceCredentialBrokerConfig {
  readonly clock: PrivilegedClock;
  readonly auditTrail: AuditTrail;
  readonly leaseTtlMs: number;
  readonly historyRetentionMs: number;
  readonly newLeaseId: () => CredentialLeaseId;
}

function addDuration(now: CredentialLease["issuedAt"], milliseconds: number) {
  const value = Date.parse(now) + milliseconds;
  if (!Number.isSafeInteger(value) || value > 8_640_000_000_000_000) {
    throw new PrivilegedServiceError(
      "invalid-contract",
      "Credential lease expiry exceeds the supported timestamp range",
    );
  }
  return instant(new Date(value).toISOString());
}

function immutableOperation(operation: ProtectedOperation): ProtectedOperation {
  return Object.freeze({
    ...operation,
    credentialRefs: Object.freeze([...operation.credentialRefs]),
  });
}

function immutableAuthorization(authorization: AuthorizationGrant): AuthorizationGrant {
  return Object.freeze({
    ...authorization,
    credentialRefs: Object.freeze([...authorization.credentialRefs]),
  });
}

function immutableLease(lease: CredentialLease): CredentialLease {
  return Object.freeze({
    ...lease,
  });
}

export class ReferenceCredentialBroker implements CredentialBroker {
  private readonly activeLeases = new Map<CredentialLeaseId, ActiveLease>();
  private readonly releasedLeases = new Map<CredentialLeaseId, ActiveLease>();
  private readonly leaseIdRetention = new Map<CredentialLeaseId, CredentialLease["expiresAt"]>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly config: ReferenceCredentialBrokerConfig) {
    if (!Number.isSafeInteger(config.leaseTtlMs) || config.leaseTtlMs < 1) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Credential leaseTtlMs must be a positive safe integer",
      );
    }
    if (!Number.isSafeInteger(config.historyRetentionMs) || config.historyRetentionMs < 1) {
      throw new PrivilegedServiceError(
        "invalid-contract",
        "Credential historyRetentionMs must be a positive safe integer",
      );
    }
    instant(config.clock.now());
  }

  async lease(
    operation: ProtectedOperation,
    authorization: AuthorizationGrant,
  ): Promise<readonly CredentialLease[]> {
    assertProtectedOperation(operation);
    assertAuthorizationGrant(authorization);
    const stableOperation = immutableOperation(operation);
    const stableAuthorization = immutableAuthorization(authorization);
    if (!authorizationMatchesOperation(stableAuthorization, stableOperation)) {
      throw new PrivilegedServiceError(
        "credential-unavailable",
        "Authorization does not match the credential operation",
      );
    }

    return this.runExclusive(() => this.issueLeases(stableOperation, stableAuthorization));
  }

  private async issueLeases(
    operation: ProtectedOperation,
    authorization: AuthorizationGrant,
  ): Promise<readonly CredentialLease[]> {
    await this.sweepExpiredLeases();
    if (operation.credentialRefs.length === 0) {
      return Object.freeze([]);
    }

    const issuedAt = this.now();
    const expiresAt = addDuration(issuedAt, this.config.leaseTtlMs);
    const retainedUntil = addDuration(expiresAt, this.config.historyRetentionMs);
    const issued: ActiveLease[] = [];

    try {
      for (const credentialRef of operation.credentialRefs) {
        const leaseId = this.config.newLeaseId();
        try {
          credentialLeaseId(leaseId);
        } catch {
          throw new PrivilegedServiceError(
            "credential-unavailable",
            "Credential lease identifier source returned an invalid identifier",
          );
        }
        if (this.leaseIdRetention.has(leaseId)) {
          throw new PrivilegedServiceError(
            "credential-unavailable",
            "Credential lease identifier source returned a duplicate identifier",
          );
        }
        this.leaseIdRetention.set(leaseId, retainedUntil);

        const lease = Object.freeze({
          leaseId,
          credentialRef,
          requestId: operation.requestId,
          authorizationGrantId: authorization.grantId,
          issuedAt,
          expiresAt,
        }) satisfies CredentialLease;
        const record = Object.freeze({
          operation,
          lease,
        }) satisfies ActiveLease;
        await this.appendAudit({
          type: "credential.lease-issued",
          context: auditContextFor(operation),
          credentialRef,
          leaseId,
          grantId: authorization.grantId,
          expiresAt,
        });
        issued.push(record);
        this.activeLeases.set(leaseId, record);
      }
    } catch (error) {
      await this.rollbackIssuedLeases(issued);
      if (error instanceof PrivilegedServiceError) {
        throw error;
      }
      throw new PrivilegedServiceError(
        "credential-unavailable",
        "Credential lease references could not be issued",
      );
    }

    return Object.freeze(issued.map(({ lease }) => lease));
  }

  async release(operation: ProtectedOperation, leases: readonly CredentialLease[]): Promise<void> {
    assertProtectedOperation(operation);
    const stableOperation = immutableOperation(operation);
    const stableLeases = Object.freeze(
      leases.map((lease) => {
        assertCredentialLease(lease);
        return immutableLease(lease);
      }),
    );
    return this.runExclusive(() => this.releaseLeases(stableOperation, stableLeases));
  }

  private async releaseLeases(
    operation: ProtectedOperation,
    leases: readonly CredentialLease[],
  ): Promise<void> {
    this.pruneLeaseHistory(this.now());
    const leaseIds = new Set<CredentialLeaseId>();
    const releases = leases.map((lease) => {
      if (leaseIds.has(lease.leaseId)) {
        throw new PrivilegedServiceError(
          "credential-release-failed",
          "Credential release request contains a duplicate lease",
        );
      }
      leaseIds.add(lease.leaseId);
      const active = this.activeLeases.get(lease.leaseId);
      const released = this.releasedLeases.get(lease.leaseId);
      const record = active ?? released;
      if (
        record === undefined ||
        !protectedOperationsEqual(record.operation, operation) ||
        record.lease.credentialRef !== lease.credentialRef ||
        record.lease.requestId !== lease.requestId ||
        record.lease.authorizationGrantId !== lease.authorizationGrantId ||
        record.lease.issuedAt !== lease.issuedAt ||
        record.lease.expiresAt !== lease.expiresAt
      ) {
        throw new PrivilegedServiceError(
          "credential-release-failed",
          "Credential lease is not active for this operation",
        );
      }
      return {
        record,
        alreadyReleased: released !== undefined,
      };
    });

    let auditError: PrivilegedServiceError | undefined;
    for (const { record, alreadyReleased } of releases) {
      if (alreadyReleased) {
        continue;
      }
      try {
        await this.appendAudit({
          type: "credential.lease-released",
          context: auditContextFor(record.operation),
          credentialRef: record.lease.credentialRef,
          leaseId: record.lease.leaseId,
          grantId: record.lease.authorizationGrantId,
        });
      } catch (error) {
        auditError ??= this.asAuditError(error, "Credential lease release audit failed");
      } finally {
        this.markReleased(record);
      }
    }
    try {
      await this.sweepExpiredLeases();
    } catch (error) {
      auditError ??= this.asAuditError(error, "Expired credential lease audit failed");
    }
    if (auditError !== undefined) {
      throw auditError;
    }
  }

  async activeLeaseCount(): Promise<number> {
    return this.runExclusive(async () => {
      await this.sweepExpiredLeases();
      return this.activeLeases.size;
    });
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
          "Audit trail acknowledged a different credential event",
        );
      }
    } catch (error) {
      throw this.asAuditError(error, "Credential audit evidence could not be recorded");
    }
  }

  private markReleased(record: ActiveLease): void {
    this.activeLeases.delete(record.lease.leaseId);
    this.releasedLeases.set(record.lease.leaseId, record);
  }

  private async rollbackIssuedLeases(records: readonly ActiveLease[]): Promise<void> {
    for (const active of records) {
      try {
        await this.appendAudit({
          type: "credential.lease-released",
          context: auditContextFor(active.operation),
          credentialRef: active.lease.credentialRef,
          leaseId: active.lease.leaseId,
          grantId: active.lease.authorizationGrantId,
        });
      } catch {
        // Rollback must reclaim reference-only state even when audit is unavailable.
      } finally {
        this.markReleased(active);
      }
    }
  }

  private async sweepExpiredLeases(): Promise<void> {
    const now = this.now();
    this.pruneLeaseHistory(now);
    const expired = [...this.activeLeases.values()].filter(
      ({ lease }) => compareInstants(now, lease.expiresAt) >= 0,
    );
    let auditError: PrivilegedServiceError | undefined;

    for (const active of expired) {
      try {
        await this.appendAudit({
          type: "credential.lease-released",
          context: auditContextFor(active.operation),
          credentialRef: active.lease.credentialRef,
          leaseId: active.lease.leaseId,
          grantId: active.lease.authorizationGrantId,
        });
      } catch (error) {
        auditError ??= this.asAuditError(error, "Expired credential lease audit failed");
      } finally {
        this.markReleased(active);
      }
    }
    this.pruneLeaseHistory(now);
    if (auditError !== undefined) {
      throw auditError;
    }
  }

  private pruneLeaseHistory(now: CredentialLease["expiresAt"]): void {
    for (const [leaseId, retainedUntil] of this.leaseIdRetention) {
      if (!this.activeLeases.has(leaseId) && compareInstants(now, retainedUntil) >= 0) {
        this.leaseIdRetention.delete(leaseId);
        this.releasedLeases.delete(leaseId);
      }
    }
  }

  private runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      (): void => {},
      (): void => {},
    );
    return result;
  }

  private asAuditError(error: unknown, message: string): PrivilegedServiceError {
    return error instanceof PrivilegedServiceError
      ? error
      : new PrivilegedServiceError("audit-unavailable", message);
  }
}
