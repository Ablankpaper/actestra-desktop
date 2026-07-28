import {
  PRIVILEGED_CONTRACT_VERSION,
  PrivilegedServiceError,
  assertAuditEvent,
  assertAuditRecord,
  auditRecordId,
  compareInstants,
  instant,
  type AuditEvent,
  type AuditRecord,
  type AuditRecordId,
  type AuditTrail,
  type PrivilegedClock,
} from "../../core";

function immutableEvent(event: AuditEvent): AuditEvent {
  const clone = structuredClone(event) as AuditEvent;
  const context = Object.freeze({ ...clone.context });

  if (clone.type === "policy.evaluated") {
    return Object.freeze({
      ...clone,
      context,
      matchedRuleIds: Object.freeze([...clone.matchedRuleIds]),
    });
  }

  return Object.freeze({
    ...clone,
    context,
  });
}

export class InMemoryAuditTrail implements AuditTrail {
  private readonly records: AuditRecord[] = [];
  private readonly recordIds = new Set<AuditRecordId>();

  constructor(
    private readonly clock: PrivilegedClock,
    private readonly newRecordId: () => AuditRecordId,
  ) {
    instant(clock.now());
  }

  async append(event: AuditEvent): Promise<AuditRecord> {
    assertAuditEvent(event);
    const occurredAt = this.clock.now();
    instant(occurredAt);
    const previous = this.records.at(-1);

    if (previous !== undefined && compareInstants(occurredAt, previous.occurredAt) < 0) {
      throw new PrivilegedServiceError("audit-unavailable", "Audit clock cannot move backwards");
    }

    const recordId = this.newRecordId();
    try {
      auditRecordId(recordId);
    } catch {
      throw new PrivilegedServiceError(
        "audit-unavailable",
        "Audit record identifier source returned an invalid identifier",
      );
    }

    if (this.recordIds.has(recordId)) {
      throw new PrivilegedServiceError(
        "audit-unavailable",
        "Audit record identifier source returned a duplicate identifier",
      );
    }

    const record = Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      recordId,
      sequence: this.records.length + 1,
      occurredAt,
      redaction: "metadata",
      event: immutableEvent(event),
    }) satisfies AuditRecord;
    assertAuditRecord(record);
    this.recordIds.add(recordId);
    this.records.push(record);
    return record;
  }

  snapshot(): readonly AuditRecord[] {
    return Object.freeze([...this.records]);
  }
}
