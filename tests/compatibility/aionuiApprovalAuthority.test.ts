// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  AionUiApprovalAuthorityContractError,
  assertAionUiApprovalDecisionRecord,
  normalizeAionUiApprovalDecisionRequest,
} from "../../apps/desktop/src/compatibility/aionui";

const BASE_REQUEST = {
  contractVersion: 1,
  method: "POST",
  path: "/api/conversations/conversation-private/confirmations/call-private/confirm",
  body: {
    msg_id: "message-private",
    data: {
      value: "proceed_once",
    },
  },
} as const;

describe("AionUi F3 approval authority contract", () => {
  it("normalizes one bounded decision into deterministic private authority identity", () => {
    const first = normalizeAionUiApprovalDecisionRequest(BASE_REQUEST);
    const second = normalizeAionUiApprovalDecisionRequest({
      ...BASE_REQUEST,
      body: {
        data: {
          value: "proceed_once",
        },
        msg_id: "message-private",
      },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      contractVersion: 1,
      decisionId: expect.stringMatching(/^actestra-approval-decision-[a-f0-9]{32}$/u),
      nativeConversationId: "conversation-private",
      nativeCallId: "call-private",
      nativeMessageId: "message-private",
      decision: "approved",
      alwaysAllow: false,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("classifies explicit outcomes without guessing the intent of opaque native option ids", () => {
    expect(
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        body: {
          msg_id: "message-private",
          data: "reject_always",
        },
      }).decision,
    ).toBe("denied");
    expect(
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        body: {
          msg_id: "message-private",
          data: "cancel",
        },
      }).decision,
    ).toBe("cancelled");
    expect(
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        body: {
          msg_id: "message-private",
          data: {
            value: "proceed_always",
          },
          always_allow: true,
        },
      }),
    ).toMatchObject({
      decision: "approved",
      alwaysAllow: true,
    });
    expect(
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        body: {
          msg_id: "message-private",
          data: "provider-generated-option-id",
        },
      }).decision,
    ).toBe("selected");
  });

  it("rejects route expansion, extra fields, and inconsistent persisted projections", () => {
    expect(() =>
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        path: "/api/providers",
      }),
    ).toThrowError(AionUiApprovalAuthorityContractError);
    expect(() =>
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        apiKey: "forbidden",
      }),
    ).toThrow(/unsupported field apiKey/u);
    expect(() =>
      normalizeAionUiApprovalDecisionRequest({
        ...BASE_REQUEST,
        body: {
          msg_id: "message-private",
          data: "deny",
          always_allow: true,
        },
      }),
    ).toThrow(/always_allow/u);

    const normalized = normalizeAionUiApprovalDecisionRequest(BASE_REQUEST);
    expect(() =>
      assertAionUiApprovalDecisionRecord({
        ...normalized,
        decision: "denied",
        deliveryState: "pending-delivery",
        attemptCount: 0,
        createdAt: "2026-07-29T05:00:00.000Z",
        updatedAt: "2026-07-29T05:00:00.000Z",
      }),
    ).toThrow(/projection/u);
  });
});
