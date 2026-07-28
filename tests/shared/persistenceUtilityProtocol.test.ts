import { describe, expect, it } from "vitest";
import {
  PERSISTENCE_UTILITY_MAX_MESSAGE_BYTES,
  PersistenceUtilityProtocolError,
  assertPersistenceUtilityMessage,
  assertPersistenceUtilityRequest,
  createPersistenceUtilityReadyMessage,
} from "../../apps/desktop/src/shared/persistenceUtilityProtocol";

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
          schemaVersion: 4,
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
