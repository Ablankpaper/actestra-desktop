export type ConversationTerminalRuntime = Readonly<{
  turn_id?: string | null;
  is_processing: boolean;
  can_send_message: boolean;
}>;

export type ConversationTerminalCorrelation = Readonly<{
  eventTurnId?: string | null;
  activeTurnId?: string | null;
}>;

export function isTerminalRuntimeForTurn(
  runtime: ConversationTerminalRuntime,
  correlation: ConversationTerminalCorrelation,
): boolean {
  if (runtime.is_processing || !runtime.can_send_message) {
    return false;
  }

  const eventTurnId = correlation.eventTurnId ?? undefined;
  const activeTurnId = correlation.activeTurnId ?? undefined;
  const runtimeTurnId = runtime.turn_id ?? undefined;
  const identities = [eventTurnId, activeTurnId, runtimeTurnId].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  // A terminal event without any identity cannot safely release a newer or
  // unrelated local turn. The durable/runtime read must be correlated first.
  if (identities.length === 0) {
    return false;
  }

  // Every identity that is present must describe the same turn. A runtime
  // terminal commonly clears turn_id, so its absence is intentionally allowed;
  // a conflicting value is never allowed.
  return identities.every((value) => value === identities[0]);
}
