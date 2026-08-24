import { describe, expect, it } from "vitest";
import {
  acknowledgeActestraOptimisticUserMessage,
  reconcileActestraOptimisticUserMessages,
} from "../../apps/desktop/src/renderer/utils/chat/optimisticUserMessage";

type TestMessage = {
  readonly id: string;
  readonly msg_id: string;
  readonly conversation_id: string;
  readonly type: "text";
  readonly position: "right";
  readonly status: "pending" | "finish";
  readonly created_at: number;
  readonly content: Readonly<{ content: string }>;
};

const optimistic = (id: string, content = "same text"): TestMessage => ({
  id,
  msg_id: id,
  conversation_id: "conversation-1",
  type: "text",
  position: "right",
  status: "pending",
  created_at: 1,
  content: { content },
});

const canonical = (id: string, content = "same text"): TestMessage => ({
  ...optimistic(id, content),
  status: "finish",
});

describe("optimistic user-message reconciliation", () => {
  it("consumes only the earliest matching optimistic message for one canonical message", () => {
    const first = optimistic("optimistic-user-first");
    const second = optimistic("optimistic-user-second");

    expect(
      reconcileActestraOptimisticUserMessages([first, second], [canonical("message-1")]),
    ).toEqual([second]);
  });

  it("matches repeated equal text one-to-one in FIFO order", () => {
    const first = optimistic("optimistic-user-first");
    const second = optimistic("optimistic-user-second");
    const different = optimistic("optimistic-user-different", "different text");

    expect(
      reconcileActestraOptimisticUserMessages(
        [first, second, different],
        [canonical("message-1"), canonical("message-2")],
      ),
    ).toEqual([different]);
  });

  it("does not consume another optimistic message when the canonical id is already projected", () => {
    const acknowledged = canonical("message-1");
    const second = optimistic("optimistic-user-second");

    expect(
      reconcileActestraOptimisticUserMessages([acknowledged, second], [canonical("message-1")]),
    ).toEqual([acknowledged, second]);
  });

  it("ignores canonical messages from another conversation or with different text", () => {
    const pending = optimistic("optimistic-user-first");
    const otherConversation = {
      ...canonical("message-1"),
      conversation_id: "conversation-2",
    };

    expect(
      reconcileActestraOptimisticUserMessages(
        [pending],
        [otherConversation, canonical("message-2", "different text")],
      ),
    ).toEqual([pending]);
  });

  it("replaces only the acknowledged optimistic id with the canonical message id", () => {
    const first = optimistic("optimistic-user-first");
    const second = optimistic("optimistic-user-second");

    expect(
      acknowledgeActestraOptimisticUserMessage(
        [first, second],
        "optimistic-user-first",
        "message-1",
      ),
    ).toEqual([
      {
        ...first,
        id: "message-1",
        msg_id: "message-1",
        status: "finish",
      },
      second,
    ]);
  });

  it("leaves the list unchanged when an ack arrives after canonical reconciliation", () => {
    const projected = canonical("message-1");
    const list = [projected];

    expect(
      acknowledgeActestraOptimisticUserMessage(
        list,
        "optimistic-user-already-consumed",
        "message-1",
      ),
    ).toBe(list);
  });

  it("removes the exact optimistic duplicate when the canonical event won the race", () => {
    const pending = optimistic("optimistic-user-first");
    const projected = canonical("message-1");

    expect(
      acknowledgeActestraOptimisticUserMessage(
        [pending, projected],
        "optimistic-user-first",
        "message-1",
      ),
    ).toEqual([projected]);
  });
});
