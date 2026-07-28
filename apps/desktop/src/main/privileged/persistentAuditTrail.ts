import { isDeepStrictEqual } from "node:util";
import {
  PrivilegedServiceError,
  assertAuditEvent,
  assertAuditRecord,
  auditRecordId,
  instant,
  type AuditEvent,
  type AuditRecord,
  type AuditRecordId,
  type AuditTrail,
  type PlatformEvidencePersistencePort,
  type PrivilegedClock,
} from "../../core";

export interface PersistentAuditTrailConfig {
  readonly clock: PrivilegedClock;
  readonly persistence: PlatformEvidencePersistencePort;
  readonly newRecordId: () => AuditRecordId;
}

function immutableEvent(event: AuditEvent): AuditEvent {
  const value = structuredClone(event);
  Object.freeze(value.context);
  if (value.type === "policy.evaluated") {
    Object.freeze(value.matchedRuleIds);
  }
  return Object.freeze(value);
}

export class PersistentAuditTrail implements AuditTrail {
  constructor(private readonly config: PersistentAuditTrailConfig) {
    instant(config.clock.now());
  }

  async append(event: AuditEvent): Promise<AuditRecord> {
    assertAuditEvent(event);
    const stableEvent = immutableEvent(event);
    const occurredAt = this.config.clock.now();
    instant(occurredAt);
    const recordId = this.config.newRecordId();
    try {
      auditRecordId(recordId);
    } catch {
      throw new PrivilegedServiceError(
        "audit-unavailable",
        "Audit record identifier source returned an invalid identifier",
      );
    }

    try {
      const record = await this.config.persistence.appendPrivilegedAudit({
        recordId,
        occurredAt,
        event: stableEvent,
      });
      assertAuditRecord(record);
      if (
        record.recordId !== recordId ||
        record.occurredAt !== occurredAt ||
        record.redaction !== "metadata" ||
        !isDeepStrictEqual(record.event, stableEvent)
      ) {
        throw new PrivilegedServiceError(
          "audit-unavailable",
          "Durable audit store acknowledged different evidence",
        );
      }
      return record;
    } catch (error) {
      if (error instanceof PrivilegedServiceError && error.code === "audit-unavailable") {
        throw error;
      }
      throw new PrivilegedServiceError(
        "audit-unavailable",
        "Durable privileged audit evidence could not be recorded",
        {
          cause: error,
        },
      );
    }
  }
}
