import { describe, expect, it } from "vitest";
import { isTerminalRuntimeForTurn } from "../../apps/desktop/src/renderer/utils/chat/conversationTerminal";

const terminal = (turn_id: string | null = null) => ({
  turn_id,
  is_processing: false,
  can_send_message: true,
});

describe("conversation stream terminal correlation", () => {
  it("accepts a terminal runtime for the same active turn even when the runtime clears its turn id", () => {
    expect(
      isTerminalRuntimeForTurn(terminal(null), {
        eventTurnId: "turn-1",
        activeTurnId: "turn-1",
      }),
    ).toBe(true);
  });

  it("uses the active turn when Finish omits a turn id", () => {
    expect(
      isTerminalRuntimeForTurn(terminal(null), {
        eventTurnId: undefined,
        activeTurnId: "turn-1",
      }),
    ).toBe(true);
  });

  it("can correlate a turn from the runtime when the local view has no active id", () => {
    expect(
      isTerminalRuntimeForTurn(terminal("turn-1"), {
        eventTurnId: "turn-1",
        activeTurnId: null,
      }),
    ).toBe(true);
  });

  it("does not let an old Finish release a newer active turn", () => {
    expect(
      isTerminalRuntimeForTurn(terminal("turn-1"), {
        eventTurnId: "turn-1",
        activeTurnId: "turn-2",
      }),
    ).toBe(false);
  });

  it("does not release when the runtime belongs to a different turn", () => {
    expect(
      isTerminalRuntimeForTurn(terminal("turn-2"), {
        eventTurnId: "turn-1",
        activeTurnId: "turn-1",
      }),
    ).toBe(false);
  });

  it("requires both backend terminal flags", () => {
    expect(
      isTerminalRuntimeForTurn(
        { ...terminal("turn-1"), is_processing: true },
        { eventTurnId: "turn-1", activeTurnId: "turn-1" },
      ),
    ).toBe(false);
    expect(
      isTerminalRuntimeForTurn(
        { ...terminal("turn-1"), can_send_message: false },
        { eventTurnId: "turn-1", activeTurnId: "turn-1" },
      ),
    ).toBe(false);
  });

  it("does not unlock without any turn identity", () => {
    expect(
      isTerminalRuntimeForTurn(terminal(null), {
        eventTurnId: undefined,
        activeTurnId: null,
      }),
    ).toBe(false);
  });
});
