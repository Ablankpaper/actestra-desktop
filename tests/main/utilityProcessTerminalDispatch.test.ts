import { describe, expect, it } from "vitest";
import {
  subscribeDeferredUtilityProcessTerminalEvent,
  type UtilityProcessTerminalListener,
} from "../../apps/desktop/src/main/workers/utilityProcessTerminalDispatch";

function nextImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe("utility-process terminal dispatch", () => {
  it("waits for the native termination stack to unwind before notifying Core", async () => {
    let registered: UtilityProcessTerminalListener<[number]> | undefined;
    const delivered: number[] = [];
    const unsubscribe = subscribeDeferredUtilityProcessTerminalEvent<[number]>(
      (listener) => {
        registered = listener;
      },
      (listener) => {
        if (registered === listener) {
          registered = undefined;
        }
      },
      (code) => {
        delivered.push(code);
      },
    );

    registered?.(9);
    expect(delivered).toEqual([]);
    await Promise.resolve();
    expect(delivered).toEqual([]);
    await nextImmediate();
    expect(delivered).toEqual([9]);

    unsubscribe();
    expect(registered).toBeUndefined();
  });

  it("cancels a queued terminal callback during competing lifecycle cleanup", async () => {
    let registered: UtilityProcessTerminalListener<[number]> | undefined;
    const delivered: number[] = [];
    const unsubscribe = subscribeDeferredUtilityProcessTerminalEvent<[number]>(
      (listener) => {
        registered = listener;
      },
      (listener) => {
        if (registered === listener) {
          registered = undefined;
        }
      },
      (code) => {
        delivered.push(code);
      },
    );

    registered?.(9);
    unsubscribe();
    await nextImmediate();
    expect(delivered).toEqual([]);
    expect(registered).toBeUndefined();
  });
});
