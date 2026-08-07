import type { DomainGraph } from "./domain";
import type { CoreEvent, CoreEventCursor, EventStreamId } from "./events";

export const PERSISTENCE_ERROR_CODES = [
  "closed",
  "foreign-database",
  "unowned-database",
  "future-schema",
  "migration-registry",
  "migration-history",
  "corrupt-database",
  "domain-reference",
  "invalid-record",
  "evidence-conflict",
  "workspace-grant-conflict",
  "content-conflict",
  "content-not-found",
  "content-ownership",
  "content-expired",
  "content-integrity",
  "content-too-large",
  "general-work-conflict",
  "general-work-journey-conflict",
  "schedule-conflict",
  "schedule-limit",
  "team-plan-conflict",
  "team-experience-conflict",
  "team-definition-conflict",
  "team-run-conflict",
  "team-message-delivery-conflict",
] as const;

export type PersistenceErrorCode = (typeof PERSISTENCE_ERROR_CODES)[number];

export class PersistenceError extends Error {
  constructor(
    readonly code: PersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PersistenceError";
  }
}

export interface PersistEventResult {
  readonly status: "appended" | "duplicate";
}

export interface CorePersistencePort {
  loadDomainGraph(): Promise<DomainGraph>;
  replaceDomainGraph(graph: DomainGraph): Promise<void>;
  /**
   * Treats eventId as an idempotency key. A structurally identical retry must
   * return duplicate, while conflicting identifier reuse must fail closed.
   */
  appendEvent(event: CoreEvent): Promise<PersistEventResult>;
  replayEvents(streamId: EventStreamId, after?: CoreEventCursor): Promise<readonly CoreEvent[]>;
  close(): Promise<void>;
}
