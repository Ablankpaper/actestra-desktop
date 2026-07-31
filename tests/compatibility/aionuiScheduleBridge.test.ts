// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toNativeCronJob } from "../../apps/desktop/src/compatibility/aionui";
import {
  ACTESTRA_SCHEDULE_EVENT_CHANNEL,
  ACTESTRA_SCHEDULE_REQUEST_CHANNEL,
  assertAionUiScheduleBridgeRequest,
  assertAionUiScheduleBridgeResponse,
  assertAionUiScheduleEvent,
  parseAionUiScheduleBridgeRequest,
} from "../../apps/desktop/src/compatibility/aionui/scheduleBridge";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

const registration = createAionUiScheduleRegistration("bridge-contract");
const job = toNativeCronJob(registration.job);

describe("AionUI schedule bridge contract", () => {
  it("accepts only the fixed native cron request routes", () => {
    expect(ACTESTRA_SCHEDULE_REQUEST_CHANNEL).toBe("actestra:schedule-request-v1");
    expect(ACTESTRA_SCHEDULE_EVENT_CHANNEL).toBe("actestra:schedule-event-v1");
    const requests = [
      {
        request: { contractVersion: 1, method: "GET", path: "/api/cron/jobs", body: undefined },
        route: { kind: "list" },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: "/api/cron/jobs?conversation_id=conversation%2Fnative",
          body: undefined,
        },
        route: { kind: "list", nativeConversationId: "conversation/native" },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/cron/jobs/${job.id}`,
          body: undefined,
        },
        route: { kind: "get", jobId: job.id },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: "/api/cron/jobs",
          body: {
            name: job.name,
            schedule: job.schedule,
            prompt: job.target.payload.text,
            conversation_id: job.metadata.conversation_id,
            created_by: "user",
            execution_mode: "existing",
          },
        },
        route: { kind: "create" },
      },
      {
        request: {
          contractVersion: 1,
          method: "PUT",
          path: `/api/cron/jobs/${job.id}`,
          body: { enabled: false },
        },
        route: { kind: "update", jobId: job.id },
      },
      {
        request: {
          contractVersion: 1,
          method: "DELETE",
          path: `/api/cron/jobs/${job.id}`,
          body: undefined,
        },
        route: { kind: "remove", jobId: job.id },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/cron/jobs/${job.id}/run`,
          body: { job_id: job.id },
        },
        route: { kind: "run", jobId: job.id },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/cron/jobs/${job.id}/conversations`,
          body: undefined,
        },
        route: { kind: "history", jobId: job.id },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/cron/jobs/${job.id}/skill`,
          body: undefined,
        },
        route: { kind: "skill", jobId: job.id },
      },
    ] as const;

    for (const { request, route } of requests) {
      expect(() => assertAionUiScheduleBridgeRequest(request)).not.toThrow();
      expect(parseAionUiScheduleBridgeRequest(request)).toMatchObject(route);
    }
  });

  it("validates native-compatible success, error, and fixed event envelopes", () => {
    const history = {
      id: job.metadata.conversation_id,
      name: job.metadata.conversation_title ?? job.name,
      extra: { cron_job_id: job.id },
      created_at: job.metadata.created_at,
      updated_at: job.metadata.updated_at,
    };
    for (const response of [
      { contractVersion: 1, status: 200, data: job },
      { contractVersion: 1, status: 200, data: [job] },
      { contractVersion: 1, status: 200, data: null },
      {
        contractVersion: 1,
        status: 200,
        data: { conversation_id: job.metadata.conversation_id },
      },
      { contractVersion: 1, status: 200, data: [history] },
      {
        contractVersion: 1,
        status: 503,
        code: "schedule-unavailable",
        message: "Actestra scheduling is unavailable",
      },
    ]) {
      expect(() => assertAionUiScheduleBridgeResponse(response)).not.toThrow();
    }
    for (const event of [
      { type: "cron.job-created", payload: job },
      { type: "cron.job-updated", payload: job },
      { type: "cron.job-removed", payload: { job_id: job.id } },
      {
        type: "cron.job-executed",
        payload: { job_id: job.id, status: "missed", error: "missed-occurrence" },
      },
    ]) {
      expect(() => assertAionUiScheduleEvent(event)).not.toThrow();
    }
  });

  it("accepts the native empty schedule description and normalizes schedule validation errors", () => {
    expect(() =>
      assertAionUiScheduleBridgeResponse({
        contractVersion: 1,
        status: 200,
        data: {
          ...job,
          schedule: {
            kind: "cron",
            expr: "",
            description: "",
          },
        },
      }),
    ).not.toThrow();

    let validationError: unknown;
    try {
      assertAionUiScheduleBridgeResponse({
        contractVersion: 1,
        status: 200,
        data: {
          ...job,
          schedule: {
            kind: "cron",
            expr: "not-a-five-field-cron",
            description: "Invalid cron",
          },
        },
      });
    } catch (error) {
      validationError = error;
    }
    expect(validationError).toMatchObject({
      name: "Error",
      message: "Native AionUI schedule has no calculable occurrence",
    });
  });

  it("rejects malformed, ambiguous, traversal, authority, and renderer-selected event input", () => {
    const invalidRequests = [
      { contractVersion: 1, method: "PATCH", path: "/api/cron/jobs", body: undefined },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs#fragment",
        body: undefined,
      },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs?conversation_id=one&conversation_id=two",
        body: undefined,
      },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs?conversation_id=%ZZ",
        body: undefined,
      },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs?conversation_id=conversation%2fnative",
        body: undefined,
      },
      {
        contractVersion: 1,
        method: "GET",
        path: `/api/cron/jobs/${job.id}/%2e%2e/skill`,
        body: undefined,
      },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs",
        body: { workspaceRoot: "/private/workspace" },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: "/api/cron/jobs",
        body: {
          name: job.name,
          schedule: job.schedule,
          prompt: job.target.payload.text,
          conversation_id: job.metadata.conversation_id,
          created_by: "user",
          execution_mode: "existing",
          workspaceRoot: "/private/workspace",
        },
      },
      {
        contractVersion: 1,
        method: "GET",
        path: "/api/cron/jobs",
        body: undefined,
        channel: "renderer-selected",
      },
    ];
    for (const request of invalidRequests) {
      expect(() => assertAionUiScheduleBridgeRequest(request)).toThrow();
    }

    for (const response of [
      { contractVersion: 1, status: 200, data: { ...job, workspaceRoot: "/private/root" } },
      {
        contractVersion: 1,
        status: 503,
        code: "schedule-unavailable",
        message: "m".repeat(513),
      },
      {
        contractVersion: 1,
        status: 503,
        code: "schedule-unavailable",
        message: "Unavailable",
        cause: "private persistence failure",
      },
    ]) {
      expect(() => assertAionUiScheduleBridgeResponse(response)).toThrow();
    }
    expect(() =>
      assertAionUiScheduleEvent({
        type: "renderer.selected-event",
        payload: { job_id: job.id },
      }),
    ).toThrow();
  });
});
