import {
  AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT,
  AionUiApprovalAuthorityContractError,
  assertAionUiApprovalDecisionRecord,
  normalizeAionUiApprovalDecisionRequest,
  type AionUiApprovalAuthorityPersistencePort,
  type AionUiApprovalDecisionRecord,
  type AionUiApprovalDecisionRequest,
  type NormalizedAionUiApprovalDecision,
} from "../../compatibility/aionui";
import { PersistenceError } from "../../core";

export type AionUiApprovalAuthorityErrorBody = {
  readonly success: false;
  readonly error: string;
  readonly code: string;
  readonly details?: unknown;
};

export type AionUiApprovalAuthorityResult =
  | {
      readonly status: "delivered";
      readonly decisionId: string;
      readonly disposition: "new" | "duplicate" | "reconciled";
      readonly attemptCount: number;
    }
  | {
      readonly status: "rejected";
      readonly httpStatus: number;
      readonly body: AionUiApprovalAuthorityErrorBody;
    };

export interface AionUiApprovalNativeTransport {
  isPending(record: AionUiApprovalDecisionRecord): Promise<boolean>;
  deliver(record: AionUiApprovalDecisionRecord): Promise<void>;
}

export interface AionUiApprovalAuthorityClock {
  now(): string;
}

export interface AionUiApprovalRecoverySummary {
  readonly attempted: number;
  readonly delivered: number;
  readonly pending: number;
}

export class AionUiApprovalNativeTransportError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: unknown,
    options?: ErrorOptions,
  ) {
    super("Native AionUi approval delivery failed", options);
    this.name = "AionUiApprovalNativeTransportError";
  }
}

class SystemApprovalAuthorityClock implements AionUiApprovalAuthorityClock {
  now(): string {
    return new Date().toISOString();
  }
}

const GENERIC_NATIVE_ERROR: AionUiApprovalAuthorityErrorBody = Object.freeze({
  success: false,
  error: "The native approval response could not be delivered.",
  code: "ACTESTRA_APPROVAL_DELIVERY_UNAVAILABLE",
});
const SENSITIVE_DETAIL_KEY = /api[_-]?key|authorization|token|secret|credential/i;
const MAX_NATIVE_DETAILS_BYTES = 4_096;

function sanitizedNativeDetails(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    const encoded = JSON.stringify(value, (key, entry) =>
      SENSITIVE_DETAIL_KEY.test(key) ? "[REDACTED]" : entry,
    );
    if (Buffer.byteLength(encoded, "utf8") > MAX_NATIVE_DETAILS_BYTES) {
      return undefined;
    }
    return JSON.parse(encoded) as unknown;
  } catch {
    return undefined;
  }
}

function rejected(
  httpStatus: number,
  code: string,
  error: string,
  details?: unknown,
): AionUiApprovalAuthorityResult {
  return Object.freeze({
    status: "rejected",
    httpStatus,
    body: Object.freeze({
      success: false as const,
      error,
      code,
      ...(details === undefined ? {} : { details }),
    }),
  });
}

function nativeErrorResult(
  error: AionUiApprovalNativeTransportError,
): AionUiApprovalAuthorityResult {
  const httpStatus =
    Number.isSafeInteger(error.httpStatus) && error.httpStatus >= 400 && error.httpStatus <= 599
      ? error.httpStatus
      : 503;
  if (typeof error.body !== "object" || error.body === null || Array.isArray(error.body)) {
    return rejected(httpStatus, GENERIC_NATIVE_ERROR.code, GENERIC_NATIVE_ERROR.error);
  }
  const body = error.body as Record<string, unknown>;
  const code =
    typeof body.code === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(body.code)
      ? body.code
      : "ACTESTRA_APPROVAL_NATIVE_REJECTED";
  const message =
    typeof body.error === "string" && body.error.length > 0 && body.error.length <= 1_024
      ? body.error
      : "The native approval response was rejected.";
  return rejected(httpStatus, code, message, sanitizedNativeDetails(body.details));
}

function errorCodeForFailure(error: unknown): string {
  if (error instanceof AionUiApprovalNativeTransportError) {
    const body = error.body;
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      typeof (body as Record<string, unknown>).code === "string"
    ) {
      const code = (body as Record<string, unknown>).code as string;
      if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(code)) {
        return code;
      }
    }
    return `native-http-${error.httpStatus}`;
  }
  return "native-delivery-unavailable";
}

export class AionUiApprovalAuthorityService {
  private readonly clock: AionUiApprovalAuthorityClock;
  private readonly activeDecisions = new Map<string, Promise<AionUiApprovalAuthorityResult>>();

  constructor(
    private readonly persistence: AionUiApprovalAuthorityPersistencePort,
    private readonly transport: AionUiApprovalNativeTransport,
    clock: AionUiApprovalAuthorityClock = new SystemApprovalAuthorityClock(),
  ) {
    this.clock = clock;
  }

  async resolve(value: unknown): Promise<AionUiApprovalAuthorityResult> {
    let decision: NormalizedAionUiApprovalDecision;
    try {
      decision = normalizeAionUiApprovalDecisionRequest(value);
    } catch (error) {
      if (error instanceof AionUiApprovalAuthorityContractError) {
        return rejected(400, "ACTESTRA_APPROVAL_INVALID_REQUEST", error.message);
      }
      return rejected(
        400,
        "ACTESTRA_APPROVAL_INVALID_REQUEST",
        "The approval response is invalid.",
      );
    }

    return this.serialize(decision.decisionId, async () => {
      let reservation;
      try {
        reservation = await this.persistence.reserveAionUiApprovalDecision(
          decision,
          this.clock.now(),
        );
      } catch (error) {
        if (error instanceof PersistenceError && error.code === "evidence-conflict") {
          return rejected(
            409,
            "ACTESTRA_APPROVAL_DECISION_CONFLICT",
            "This approval request already has a different immutable decision.",
          );
        }
        return rejected(
          503,
          "ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE",
          "Actestra could not persist the approval decision.",
        );
      }
      return this.deliverRecord(
        reservation.record,
        reservation.status === "duplicate" ? "duplicate" : "new",
      );
    });
  }

  async recoverPending(): Promise<AionUiApprovalRecoverySummary> {
    const records = await this.persistence.listPendingAionUiApprovalDecisions(
      AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT,
    );
    let delivered = 0;
    for (const listed of records) {
      const result = await this.serialize(listed.decisionId, async () => {
        const current = await this.persistence.getAionUiApprovalDecision(listed.decisionId);
        if (current === undefined) {
          return rejected(
            503,
            "ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE",
            "Actestra approval recovery lost its durable decision.",
          );
        }
        return this.deliverRecord(current, "reconciled");
      });
      if (result.status === "delivered") {
        delivered += 1;
      }
    }
    return Object.freeze({
      attempted: records.length,
      delivered,
      pending: records.length - delivered,
    });
  }

  private serialize(
    decisionId: string,
    work: () => Promise<AionUiApprovalAuthorityResult>,
  ): Promise<AionUiApprovalAuthorityResult> {
    const prior = this.activeDecisions.get(decisionId);
    const ready: Promise<void> =
      prior === undefined
        ? Promise.resolve()
        : prior.then(
            (): void => {},
            (): void => {},
          );
    const next = ready.then(work).finally(() => {
      if (this.activeDecisions.get(decisionId) === next) {
        this.activeDecisions.delete(decisionId);
      }
    });
    this.activeDecisions.set(decisionId, next);
    return next;
  }

  private async deliverRecord(
    record: AionUiApprovalDecisionRecord,
    disposition: "new" | "duplicate" | "reconciled",
  ): Promise<AionUiApprovalAuthorityResult> {
    assertAionUiApprovalDecisionRecord(record);
    if (record.deliveryState === "delivered") {
      return Object.freeze({
        status: "delivered",
        decisionId: record.decisionId,
        disposition: "duplicate",
        attemptCount: record.attemptCount,
      });
    }

    if (record.attemptCount > 0) {
      try {
        if (!(await this.transport.isPending(record))) {
          const reconciled = await this.persistence.markAionUiApprovalDelivered(
            record.decisionId,
            this.clock.now(),
          );
          return Object.freeze({
            status: "delivered",
            decisionId: reconciled.decisionId,
            disposition: "reconciled",
            attemptCount: reconciled.attemptCount,
          });
        }
      } catch {
        return rejected(
          503,
          "ACTESTRA_APPROVAL_RECONCILIATION_UNAVAILABLE",
          "Actestra could not verify the pending native approval before retrying.",
        );
      }
    }

    let attempted: AionUiApprovalDecisionRecord;
    try {
      attempted = await this.persistence.beginAionUiApprovalDelivery(
        record.decisionId,
        this.clock.now(),
      );
      if (attempted.deliveryState === "delivered") {
        return Object.freeze({
          status: "delivered",
          decisionId: attempted.decisionId,
          disposition: "duplicate",
          attemptCount: attempted.attemptCount,
        });
      }
    } catch {
      return rejected(
        503,
        "ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE",
        "Actestra could not reserve approval delivery.",
      );
    }

    try {
      await this.transport.deliver(attempted);
      const delivered = await this.persistence.markAionUiApprovalDelivered(
        attempted.decisionId,
        this.clock.now(),
      );
      return Object.freeze({
        status: "delivered",
        decisionId: delivered.decisionId,
        disposition,
        attemptCount: delivered.attemptCount,
      });
    } catch (error) {
      try {
        if (!(await this.transport.isPending(attempted))) {
          const delivered = await this.persistence.markAionUiApprovalDelivered(
            attempted.decisionId,
            this.clock.now(),
          );
          return Object.freeze({
            status: "delivered",
            decisionId: delivered.decisionId,
            disposition: "reconciled",
            attemptCount: delivered.attemptCount,
          });
        }
      } catch {
        // The original native failure remains the user-facing error.
      }

      try {
        await this.persistence.markAionUiApprovalDeliveryFailed(
          attempted.decisionId,
          errorCodeForFailure(error),
          this.clock.now(),
        );
      } catch {
        return rejected(
          503,
          "ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE",
          "Actestra could not persist the failed approval delivery.",
        );
      }
      return error instanceof AionUiApprovalNativeTransportError
        ? nativeErrorResult(error)
        : rejected(503, GENERIC_NATIVE_ERROR.code, GENERIC_NATIVE_ERROR.error);
    }
  }
}

export function approvalDecisionRequestForNative(
  path: string,
  body: AionUiApprovalDecisionRequest["body"],
): AionUiApprovalDecisionRequest {
  return Object.freeze({
    contractVersion: 1,
    method: "POST",
    path,
    body,
  });
}

export function validateAionUiApprovalAuthorityResult(
  value: unknown,
): asserts value is AionUiApprovalAuthorityResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval authority result must be an object",
    );
  }
  const result = value as Record<string, unknown>;
  if (result.status === "delivered") {
    if (
      typeof result.decisionId !== "string" ||
      !/^actestra-approval-decision-[a-f0-9]{32}$/u.test(result.decisionId) ||
      (result.disposition !== "new" &&
        result.disposition !== "duplicate" &&
        result.disposition !== "reconciled") ||
      !Number.isSafeInteger(result.attemptCount) ||
      (result.attemptCount as number) < 1
    ) {
      throw new AionUiApprovalAuthorityContractError("AionUi approval delivered result is invalid");
    }
    return;
  }
  if (
    result.status !== "rejected" ||
    !Number.isSafeInteger(result.httpStatus) ||
    (result.httpStatus as number) < 400 ||
    (result.httpStatus as number) > 599 ||
    typeof result.body !== "object" ||
    result.body === null ||
    Array.isArray(result.body)
  ) {
    throw new AionUiApprovalAuthorityContractError("AionUi approval rejected result is invalid");
  }
  const body = result.body as Record<string, unknown>;
  if (body.success !== false || typeof body.error !== "string" || typeof body.code !== "string") {
    throw new AionUiApprovalAuthorityContractError("AionUi approval error mapping is invalid");
  }
}
