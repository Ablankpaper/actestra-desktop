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
