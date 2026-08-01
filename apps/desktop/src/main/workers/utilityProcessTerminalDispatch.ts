export type UtilityProcessTerminalListener<Arguments extends unknown[]> = (
  ...arguments_: Arguments
) => void;

export function subscribeDeferredUtilityProcessTerminalEvent<Arguments extends unknown[]>(
  register: (listener: UtilityProcessTerminalListener<Arguments>) => void,
  unregister: (listener: UtilityProcessTerminalListener<Arguments>) => void,
  listener: UtilityProcessTerminalListener<Arguments>,
): () => void {
  let active = true;
  let triggered = false;
  let scheduled: ReturnType<typeof setImmediate> | null = null;

  const handleTerminalEvent: UtilityProcessTerminalListener<Arguments> = (...arguments_) => {
    if (!active || triggered) {
      return;
    }
    triggered = true;
    scheduled = setImmediate(() => {
      scheduled = null;
      if (active) {
        listener(...arguments_);
      }
    });
  };

  register(handleTerminalEvent);
  return () => {
    if (!active) {
      return;
    }
    active = false;
    unregister(handleTerminalEvent);
    if (scheduled !== null) {
      clearImmediate(scheduled);
      scheduled = null;
    }
  };
}
