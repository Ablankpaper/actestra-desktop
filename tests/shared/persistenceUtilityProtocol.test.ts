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
import { createTeamRunFixture } from "../fixtures/teamRun";
import {
  instant,
  normalizeStandardTeamMessageDelivery,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
} from "../../apps/desktop/src/core";

describe("persistence utility protocol", () => {
  it("admits only the three bounded P7.4 privileged-audit operations and results", () => {
    const retention = {
      contractVersion: 1,
      policyVersion: 1,
      maxAgeDays: 90,
      maxRecordCount: 100_000,
      retainedRecordCount: 0,
      prunedRecordCount: 0,
      firstRetainedSequence: null,
      lastSequence: 0,
      chainHeadSha256: "a".repeat(64),
      lastMaintainedAt: instant("2026-08-16T07:00:00.000Z"),
    } as const;
    const requests = [
      {
        operation: "maintain-privileged-audit",
        payload: { now: instant("2026-08-16T07:00:00.000Z") },
      },
      { operation: "list-privileged-audit", payload: { limit: 1_000 } },
      { operation: "read-privileged-audit-retention-state", payload: {} },
    ] as const;
    requests.forEach((request, index) => {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: `persistence-p7-4-request-${String(index + 1)}`,
          ...request,
        }),
      ).not.toThrow();
    });

    const responses = [
      { operation: "maintain-privileged-audit", result: retention },
      { operation: "list-privileged-audit", result: [] },
      { operation: "read-privileged-audit-retention-state", result: retention },
    ] as const;
    responses.forEach((response, index) => {
      expect(() =>
        assertPersistenceUtilityMessage({
          protocolVersion: 1,
          type: "response",
          requestId: `persistence-p7-4-response-${String(index + 1)}`,
          status: "ok",
          ...response,
        }),
      ).not.toThrow();
    });

    for (const request of [
      { operation: "maintain-privileged-audit", payload: { now: "not-an-instant" } },
      {
        operation: "maintain-privileged-audit",
        payload: { now: "2026-08-16T07:00:00.000Z", callerPolicy: { maxAgeDays: 365 } },
      },
      { operation: "list-privileged-audit", payload: { limit: 0 } },
      { operation: "list-privileged-audit", payload: { limit: 1_001 } },
      { operation: "read-privileged-audit-retention-state", payload: { includeRaw: true } },
    ]) {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: "persistence-p7-4-rejected",
          ...request,
        }),
      ).toThrow(PersistenceUtilityProtocolError);
    }

    for (const response of [
      {
        operation: "maintain-privileged-audit",
        result: { ...retention, chainHeadSha256: "not-a-digest" },
      },
      { operation: "list-privileged-audit", result: [{}] },
      {
        operation: "read-privileged-audit-retention-state",
        result: { ...retention, retainedRecordCount: 1 },
      },
    ]) {
      expect(() =>
        assertPersistenceUtilityMessage({
          protocolVersion: 1,
          type: "response",
          requestId: "persistence-p7-4-result-rejected",
          status: "ok",
          ...response,
        }),
      ).toThrow(PersistenceUtilityProtocolError);
    }
  });

  it("accepts only the fourteen closed Team persistence operations through schema 17", async () => {
    const { team, accepted } = await createTeamRunFixture("protocol");
    const binding = normalizeTeamExperienceBinding({
      contractVersion: 1,
      teamId: "native-team-protocol",
      experience: "standard",
      boundAt: "2026-08-06T02:15:00.000Z",
    });
    const delivery = normalizeStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"a".repeat(64)}`,
      clientRequestNonce: `team-request-${"b".repeat(64)}`,
      requestSha256: "c".repeat(64),
      teamId: binding.teamId,
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: "2026-08-06T08:00:00.000Z",
      updatedAt: "2026-08-06T08:00:00.000Z",
    });
    const replacement = normalizeTeamDefinition({
      ...team,
      name: "Protocol replacement Team",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    const requests = [
      { operation: "persist-team-experience-binding", payload: { binding } },
      { operation: "get-team-experience-binding", payload: { teamId: binding.teamId } },
      { operation: "persist-standard-team-message-delivery", payload: { delivery } },
      {
        operation: "get-standard-team-message-delivery",
        payload: { deliveryId: delivery.deliveryId },
      },
      { operation: "list-unresolved-standard-team-message-deliveries", payload: { limit: 100 } },
      { operation: "persist-team-definition", payload: { team } },
      { operation: "get-team-definition", payload: { teamId: team.teamId } },
      { operation: "list-team-definitions", payload: { limit: 100 } },
      { operation: "replace-team-definition", payload: { expected: team, replacement } },
      {
        operation: "remove-team-definition",
        payload: { expected: replacement, removedAt: instant("2026-08-04T01:00:03.000Z") },
      },
      { operation: "persist-team-run-snapshot", payload: { snapshot: accepted } },
      { operation: "get-team-run-snapshot", payload: { runId: accepted.runId } },
      { operation: "list-recoverable-team-runs", payload: { limit: 100 } },
      { operation: "list-team-runs-for-team", payload: { teamId: team.teamId, limit: 100 } },
    ] as const;
    for (const [index, request] of requests.entries()) {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: `persistence-team-request-${String(index + 1)}`,
          ...request,
        }),
      ).not.toThrow();
    }

    const responses = [
      {
        operation: "persist-team-experience-binding",
        result: { status: "stored", binding },
      },
      { operation: "get-team-experience-binding", result: binding },
      {
        operation: "persist-standard-team-message-delivery",
        result: { status: "stored", delivery },
      },
      { operation: "get-standard-team-message-delivery", result: delivery },
      { operation: "list-unresolved-standard-team-message-deliveries", result: [delivery] },
      {
        operation: "persist-team-definition",
        result: { status: "stored", team },
      },
      { operation: "get-team-definition", result: team },
      { operation: "list-team-definitions", result: [team] },
      {
        operation: "replace-team-definition",
        result: { status: "stored", team: replacement },
      },
      {
        operation: "remove-team-definition",
        result: { status: "removed", teamId: team.teamId },
      },
      {
        operation: "persist-team-run-snapshot",
        result: { status: "stored", snapshot: accepted },
      },
      { operation: "get-team-run-snapshot", result: accepted },
      { operation: "list-recoverable-team-runs", result: [accepted] },
      { operation: "list-team-runs-for-team", result: [accepted] },
    ] as const;
    for (const [index, response] of responses.entries()) {
      expect(() =>
        assertPersistenceUtilityMessage({
          protocolVersion: 1,
          type: "response",
          requestId: `persistence-team-response-${String(index + 1)}`,
          status: "ok",
          ...response,
        }),
      ).not.toThrow();
    }

    for (const rejected of [
      {
        operation: "persist-team-experience-binding",
        payload: { binding, rendererGuess: true },
      },
      { operation: "get-team-experience-binding", payload: { teamId: " native-team" } },
      {
        operation: "persist-standard-team-message-delivery",
        payload: { delivery, content: "must not cross utility protocol" },
      },
      {
        operation: "get-standard-team-message-delivery",
        payload: { deliveryId: "provider-owned-message" },
      },
      { operation: "list-unresolved-standard-team-message-deliveries", payload: { limit: 101 } },
      {
        operation: "persist-team-definition",
        payload: { team, rootPath: "/private/unowned" },
      },
      { operation: "list-team-definitions", payload: { limit: 101 } },
      { operation: "get-team-run-snapshot", payload: { runId: "worker-owned-run" } },
      { operation: "list-recoverable-team-runs", payload: { limit: 0 } },
      {
        operation: "remove-team-definition",
        payload: { expected: replacement, removedAt: "not-an-instant" },
      },
    ]) {
      expect(() =>
        assertPersistenceUtilityRequest({
          protocolVersion: 1,
          type: "request",
          requestId: "persistence-team-request-rejected",
          ...rejected,
        }),
      ).toThrow(PersistenceUtilityProtocolError);
    }
  });

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

    expect(() =>
      assertPersistenceUtilityRequest({
        protocolVersion: 1,
        type: "request",
        requestId: "persistence-schedule-request-unknown",
        operation: "inspect-aionui-schedule",
        payload: {},
      }),
    ).toThrow(PersistenceUtilityProtocolError);

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
