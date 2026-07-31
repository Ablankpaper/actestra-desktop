import { describe, expect, it } from "vitest";
import {
  PERSISTENCE_UTILITY_MAX_MESSAGE_BYTES,
  PersistenceUtilityProtocolError,
  assertPersistenceUtilityMessage,
  assertPersistenceUtilityRequest,
  createPersistenceUtilityReadyMessage,
} from "../../apps/desktop/src/shared/persistenceUtilityProtocol";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";
import { createAionUiGeneralWorkRegistration } from "../fixtures/aionuiGeneralWork";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

describe("persistence utility protocol", () => {
  it("accepts exact ready, request, and operation-specific response envelopes", () => {
    expect(() =>
      assertPersistenceUtilityMessage(createPersistenceUtilityReadyMessage()),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-1",
        operation: "open",
        payload: {
          userDataPath: "/tmp/actestra-profile",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-1",
        operation: "open",
        status: "ok",
        result: {
          schemaVersion: 6,
        },
      }),
    ).not.toThrow();
    const checkpoint = createGeneralWorkCheckpoint();
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-3",
        operation: "persist-general-work-checkpoint",
        payload: { checkpoint },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-3",
        operation: "persist-general-work-checkpoint",
        status: "ok",
        result: {
          status: "stored",
          checkpoint,
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-2",
        operation: "get-aionui-approval-decision",
        status: "ok",
        result: null,
      }),
    ).not.toThrow();
  });

  it("accepts only hashed AionUI general-work link lookups", () => {
    const conversationHash = "8d67d46a10371f76a7a3cfbf44cfdc87d14c3f8b62328e48ac8e7aca70153961";
    const link = {
      contractVersion: 1,
      conversationHash,
      taskId: "task-journey-protocol-1",
      journeyKind: "prompt-artifact",
      createdAt: "2026-07-30T06:30:00.000Z",
    };
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-general-work-list",
        operation: "list-aionui-general-work-links",
        payload: {
          conversationHash,
          limit: 10,
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-general-work-list",
        operation: "list-aionui-general-work-links",
        status: "ok",
        result: [link],
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-general-work-prepared",
        operation: "list-prepared-aionui-general-work-links",
        payload: {
          limit: 10,
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-general-work-prepared",
        operation: "list-prepared-aionui-general-work-links",
        status: "ok",
        result: [link],
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-general-work-raw",
        operation: "list-aionui-general-work-links",
        payload: {
          conversationHash: "conversation-native-1",
          limit: 10,
        },
      }),
    ).toThrow(PersistenceUtilityProtocolError);
  });

  it("accepts one exact AionUI general-work atomic registration", () => {
    const registration = createAionUiGeneralWorkRegistration("protocol-1");
    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-request-general-work-register",
        operation: "register-aionui-general-work",
        payload: { registration },
      }),
    ).not.toThrow();
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-general-work-register",
        operation: "register-aionui-general-work",
        status: "ok",
        result: {
          status: "stored",
          link: registration.link,
        },
      }),
    ).not.toThrow();
  });

  it("accepts only the eight closed AionUI schedule persistence operations", () => {
    const registration = createAionUiScheduleRegistration("protocol");
    const claimedJob = {
      ...registration.job,
      nextRunAtMs: undefined,
      activeClaim: "claim-protocol-1",
      activeClaimedAtMs: registration.job.updatedAtMs + 1,
      runSequence: 1,
      updatedAtMs: registration.job.updatedAtMs + 1,
    };
    const requests = [
      {
        operation: "register-aionui-schedule",
        payload: { registration },
      },
      {
        operation: "list-aionui-schedules",
        payload: { input: { limit: 100, conversationHash: registration.job.conversationHash } },
      },
      {
        operation: "get-aionui-schedule",
        payload: { jobId: registration.job.id },
      },
      {
        operation: "update-aionui-schedule",
        payload: {
          input: {
            jobId: registration.job.id,
            updatedAtMs: registration.job.updatedAtMs + 1,
            enabled: false,
          },
        },
      },
      {
        operation: "delete-aionui-schedule",
        payload: {
          input: {
            jobId: registration.job.id,
            deletedAtMs: registration.job.updatedAtMs + 1,
          },
        },
      },
      {
        operation: "claim-aionui-schedule-run",
        payload: {
          input: {
            jobId: registration.job.id,
            claim: "claim-protocol-1",
            claimedAtMs: registration.job.updatedAtMs + 1,
          },
        },
      },
      {
        operation: "complete-aionui-schedule-run",
        payload: {
          input: {
            jobId: registration.job.id,
            claim: "claim-protocol-1",
            completedAtMs: registration.job.updatedAtMs + 2,
            status: "ok",
          },
        },
      },
      {
        operation: "recover-aionui-schedule-runs",
        payload: { input: { recoveredAtMs: registration.job.updatedAtMs + 3 } },
      },
    ] as const;
    for (const [index, request] of requests.entries()) {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: `persistence-schedule-request-${String(index + 1)}`,
          ...request,
        }),
      ).not.toThrow();
    }

    const responses = [
      {
        operation: "register-aionui-schedule",
        result: { status: "stored", job: registration.job },
      },
      { operation: "list-aionui-schedules", result: [registration.job] },
      { operation: "get-aionui-schedule", result: registration.job },
      {
        operation: "update-aionui-schedule",
        result: { status: "updated", job: registration.job },
      },
      {
        operation: "delete-aionui-schedule",
        result: { status: "not-found" },
      },
      {
        operation: "claim-aionui-schedule-run",
        result: { status: "claimed", job: claimedJob },
      },
      {
        operation: "complete-aionui-schedule-run",
        result: { status: "claim-mismatch", job: claimedJob },
      },
      { operation: "recover-aionui-schedule-runs", result: [registration.job] },
    ] as const;
    for (const [index, response] of responses.entries()) {
      expect(() =>
        assertPersistenceUtilityMessage({
          protocolVersion: 1,
          type: "response",
          requestId: `persistence-schedule-response-${String(index + 1)}`,
          status: "ok",
          ...response,
        }),
      ).not.toThrow();
    }
  });

  it("rejects schedule authority fields and operation-result substitution", () => {
    const registration = createAionUiScheduleRegistration("protocol-reject");
    for (const request of [
      {
        operation: "list-aionui-schedules",
        payload: { input: { limit: 100, rootPath: registration.workspaceGrant.rootPath } },
      },
      {
        operation: "list-aionui-schedules",
        payload: { input: { limit: 100, credential: "private" } },
      },
      {
        operation: "list-aionui-schedules",
        payload: { input: { limit: 100, conversationHash: "conversation-native" } },
      },
      {
        operation: "claim-aionui-schedule-run",
        payload: { input: { jobId: registration.job.id, claim: "claim-without-time" } },
      },
    ]) {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: "persistence-schedule-rejected",
          ...request,
        }),
      ).toThrow(PersistenceUtilityProtocolError);
    }

    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-schedule-result-substitution",
        operation: "list-aionui-schedules",
        status: "ok",
        result: { status: "stored", job: registration.job },
      }),
    ).toThrow(PersistenceUtilityProtocolError);
  });

  it("rejects extra fields, incompatible versions, and invalid result shapes", () => {
    for (const message of [
      {
        ...createPersistenceUtilityReadyMessage(),
        unexpected: true,
      },
      {
        protocolVersion: 2,
        type: "ready",
        role: "persistence",
      },
      {
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-1",
        operation: "open",
        status: "ok",
        result: {
          schemaVersion: 0,
        },
      },
      {
        protocolVersion: 1,
        type: "response",
        requestId: "persistence-request-1",
        operation: "close",
        status: "ok",
        result: {
          closed: true,
        },
      },
    ]) {
      expect(() => assertPersistenceUtilityMessage(message)).toThrow(
        PersistenceUtilityProtocolError,
      );
    }
  });

  it("rejects unserializable and oversized messages before dispatch", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertPersistenceUtilityMessage(cyclic)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(/serializable/i),
      }),
    );
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "fatal",
        role: "persistence",
        code: "fatal-error",
        message: "x".repeat(PERSISTENCE_UTILITY_MAX_MESSAGE_BYTES + 1),
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(/bound/i),
      }),
    );
  });
});
