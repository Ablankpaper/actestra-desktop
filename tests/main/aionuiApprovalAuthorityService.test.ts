// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AionUiApprovalAuthorityPersistencePort,
  AionUiApprovalDecisionRecord,
  AionUiApprovalDecisionRequest,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  AionUiApprovalAuthorityService,
  AionUiApprovalNativeTransportError,
  type AionUiApprovalAuthorityClock,
  type AionUiApprovalNativeTransport,
} from "../../apps/desktop/src/main/compatibility/aionuiApprovalAuthorityService";
import { openSqliteCorePersistence } from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-approval-service-test-"));
  testDirectories.push(directory);
  return directory;
}

function request(value = "proceed_once"): AionUiApprovalDecisionRequest {
  return {
    contractVersion: 1,
    method: "POST",
    path: "/api/conversations/conversation-private/confirmations/call-private/confirm",
    body: {
      msg_id: "message-private",
      data: {
        value,
      },
    },
  };
}

function clock(): AionUiApprovalAuthorityClock {
  let milliseconds = Date.parse("2026-07-29T05:00:00.000Z");
  return {
    now: () => {
      const value = new Date(milliseconds).toISOString();
      milliseconds += 1_000;
      return value;
    },
  };
}

function transport(overrides: Partial<AionUiApprovalNativeTransport> = {}) {
  return {
    isPending: vi.fn(async () => true),
    deliver: vi.fn(async () => undefined),
    ...overrides,
  } satisfies AionUiApprovalNativeTransport;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-approval-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("AionUi F3 approval authority service", () => {
  it("serializes concurrent decisions, delivers once, and returns an idempotent duplicate", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const service = new AionUiApprovalAuthorityService(persistence, native, clock());

    const [first, concurrent] = await Promise.all([
      service.resolve(request()),
      service.resolve(request()),
    ]);
    expect(first).toMatchObject({
      status: "delivered",
      disposition: "new",
      attemptCount: 1,
    });
    expect(concurrent).toMatchObject({
      status: "delivered",
      disposition: "duplicate",
      attemptCount: 1,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    expect(native.isPending).not.toHaveBeenCalled();
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: "delivered",
      disposition: "duplicate",
      attemptCount: 1,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    await persistence.close();
  });

  it("preserves native error status and retries only after pending-state reconciliation", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const deliver = vi
      .fn<(record: AionUiApprovalDecisionRecord) => Promise<void>>()
      .mockRejectedValueOnce(
        new AionUiApprovalNativeTransportError(409, {
          success: false,
          error: "Native confirmation is still busy",
          code: "CONFIRMATION_BUSY",
        }),
      )
      .mockResolvedValueOnce(undefined);
    const native = transport({
      deliver,
    });
    const service = new AionUiApprovalAuthorityService(persistence, native, clock());

    await expect(service.resolve(request())).resolves.toEqual({
      status: "rejected",
      httpStatus: 409,
      body: {
        success: false,
        error: "Native confirmation is still busy",
        code: "CONFIRMATION_BUSY",
      },
    });
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: "delivered",
      disposition: "duplicate",
      attemptCount: 2,
    });
    expect(native.isPending).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(2);
    await persistence.close();
  });

  it("redacts sensitive native error details before returning them to the renderer", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport({
      deliver: vi.fn(async () => {
        throw new AionUiApprovalNativeTransportError(422, {
          success: false,
          error: "Native confirmation rejected the selection",
          code: "CONFIRMATION_INVALID",
          details: {
            token: "native-secret",
            safe: "selection-invalid",
            nested: {
              api_key: "also-secret",
            },
          },
        });
      }),
    });
    const service = new AionUiApprovalAuthorityService(persistence, native, clock());

    await expect(service.resolve(request())).resolves.toEqual({
      status: "rejected",
      httpStatus: 422,
      body: {
        success: false,
        error: "Native confirmation rejected the selection",
        code: "CONFIRMATION_INVALID",
        details: {
          token: "[REDACTED]",
          safe: "selection-invalid",
          nested: {
            api_key: "[REDACTED]",
          },
        },
      },
    });
    await persistence.close();
  });

  it("reconciles a crash-after-native-acceptance without redelivering", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport({
      isPending: vi.fn(async () => false),
    });
    const service = new AionUiApprovalAuthorityService(persistence, native, clock());
    const normalizedRequest = request();
    const normalized = (
      await import("../../apps/desktop/src/compatibility/aionui")
    ).normalizeAionUiApprovalDecisionRequest(normalizedRequest);
    await persistence.reserveAionUiApprovalDecision(normalized, "2026-07-29T05:00:00.000Z");
    await persistence.beginAionUiApprovalDelivery(
      normalized.decisionId,
      "2026-07-29T05:00:01.000Z",
    );

    await expect(service.resolve(normalizedRequest)).resolves.toMatchObject({
      status: "delivered",
      disposition: "reconciled",
      attemptCount: 1,
    });
    expect(native.deliver).not.toHaveBeenCalled();
    await persistence.close();
  });

  it("recovers a durable pending decision after restart", async () => {
    const userDataPath = createTestDirectory();
    const first = openSqliteCorePersistence(userDataPath);
    const normalized = (
      await import("../../apps/desktop/src/compatibility/aionui")
    ).normalizeAionUiApprovalDecisionRequest(request("deny"));
    await first.reserveAionUiApprovalDecision(normalized, "2026-07-29T05:00:00.000Z");
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const native = transport();
    const service = new AionUiApprovalAuthorityService(reopened, native, clock());
    await expect(service.recoverPending()).resolves.toEqual({
      attempted: 1,
      delivered: 1,
      pending: 0,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    await expect(reopened.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 0,
      deliveredCount: 1,
    });
    await reopened.close();
  });

  it("bounds a transport that never settles and blocks redelivery while it remains in flight", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    let settleDelivery: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => {
      settleDelivery = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const native = transport({
      isPending: vi.fn(async () => false),
      deliver: vi.fn((_record: AionUiApprovalDecisionRecord, signal: AbortSignal) => {
        observedSignal = signal;
        return delivery;
      }),
    });
    const service = new AionUiApprovalAuthorityService(persistence, native, clock(), 5);

    await expect(service.resolve(request())).resolves.toEqual({
      status: "rejected",
      httpStatus: 503,
      body: {
        success: false,
        error: "The native approval response could not be delivered.",
        code: "ACTESTRA_APPROVAL_DELIVERY_UNAVAILABLE",
      },
    });
    expect(observedSignal?.aborted).toBe(true);
    await expect(persistence.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: "rejected",
      httpStatus: 503,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    expect(native.isPending).not.toHaveBeenCalled();

    settleDelivery?.();
    await delivery;
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: "delivered",
      disposition: "reconciled",
      attemptCount: 1,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    expect(native.isPending).toHaveBeenCalledTimes(1);
    await persistence.close();
  });

  it("fails closed when persistence returns an invalid durable record", async () => {
    const persistence = {
      reserveAionUiApprovalDecision: vi.fn(async () => ({
        status: "created" as const,
        record: {
          decisionId: "invalid-record",
        } as AionUiApprovalDecisionRecord,
      })),
    } as unknown as AionUiApprovalAuthorityPersistencePort;
    const native = transport();
    const service = new AionUiApprovalAuthorityService(persistence, native, clock());

    await expect(service.resolve(request())).resolves.toEqual({
      status: "rejected",
      httpStatus: 503,
      body: {
        success: false,
        error: "Actestra loaded an invalid durable approval decision.",
        code: "ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE",
      },
    });
    expect(native.deliver).not.toHaveBeenCalled();
  });
});
