import type { DomainGraph } from "./domain";
import type { CoreEvent, CoreEventCursor, EventStreamId } from "./events";

export type PersistenceErrorCode =
  | "closed"
  | "foreign-database"
  | "unowned-database"
  | "future-schema"
  | "migration-registry"
  | "migration-history"
  | "corrupt-database"
  | "domain-reference";

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
  appendEvent(event: CoreEvent): Promise<PersistEventResult>;
  replayEvents(streamId: EventStreamId, after?: CoreEventCursor): Promise<readonly CoreEvent[]>;
  close(): Promise<void>;
}
