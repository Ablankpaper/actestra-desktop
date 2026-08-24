/**
 * Renderer-only optimistic projection for a message that is still being
 * admitted by Main. It carries no persistence, filesystem, or transport
 * authority; the canonical userCreated/history record replaces it after the
 * request is accepted.
 */
export type ActestraOptimisticUserMessage = Readonly<{
  id: string;
  msg_id: string;
  conversation_id: string;
  type: "text";
  position: "right";
  status: "pending";
  created_at: number;
  content: Readonly<{ content: string }>;
}>;

type UserMessageLike = Readonly<{
  id?: string;
  msg_id?: string;
  conversation_id?: string;
  type: string;
  position?: string;
  status?: string;
  content?: unknown;
}>;

let fallbackSequence = 0;

function nextId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `optimistic-user-${globalThis.crypto.randomUUID()}`;
  }
  fallbackSequence += 1;
  return `optimistic-user-${Date.now()}-${fallbackSequence}`;
}

export function createActestraOptimisticUserMessage(
  conversationId: string,
  content: string,
): ActestraOptimisticUserMessage {
  const id = nextId();
  return Object.freeze({
    id,
    msg_id: id,
    conversation_id: conversationId,
    type: "text" as const,
    position: "right" as const,
    status: "pending" as const,
    created_at: Date.now(),
    content: Object.freeze({ content }),
  });
}

export function isActestraOptimisticUserMessage(message: {
  type: string;
  msg_id?: string;
}): boolean {
  return message.type === "text" && message.msg_id?.startsWith("optimistic-user-") === true;
}

function userTextContent(message: UserMessageLike): string | undefined {
  if (
    message.type !== "text" ||
    message.position !== "right" ||
    typeof message.content !== "object" ||
    message.content === null ||
    !("content" in message.content) ||
    typeof message.content.content !== "string"
  ) {
    return undefined;
  }
  return message.content.content;
}

/**
 * Remove at most one pending projection for every newly observed canonical
 * user message. Equal text is deliberately matched FIFO rather than as a set:
 * two consecutive equal sends are two different user actions.
 */
export function reconcileActestraOptimisticUserMessages<T extends UserMessageLike>(
  messages: readonly T[],
  canonicalMessages: readonly UserMessageLike[],
): T[] {
  if (messages.length === 0 || canonicalMessages.length === 0) {
    return messages as T[];
  }

  const projectedCanonicalIds = new Set(
    messages
      .filter((message) => !isActestraOptimisticUserMessage(message))
      .map((message) => message.msg_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const consumedIndexes = new Set<number>();
  const observedCanonicalIds = new Set<string>();

  for (const canonical of canonicalMessages) {
    const canonicalId = canonical.msg_id;
    const content = userTextContent(canonical);
    if (
      canonical.type !== "text" ||
      canonical.position !== "right" ||
      typeof canonicalId !== "string" ||
      canonicalId.length === 0 ||
      content === undefined ||
      projectedCanonicalIds.has(canonicalId) ||
      observedCanonicalIds.has(canonicalId)
    ) {
      continue;
    }
    observedCanonicalIds.add(canonicalId);

    const optimisticIndex = messages.findIndex(
      (message, index) =>
        !consumedIndexes.has(index) &&
        isActestraOptimisticUserMessage(message) &&
        message.conversation_id === canonical.conversation_id &&
        userTextContent(message) === content,
    );
    if (optimisticIndex !== -1) {
      consumedIndexes.add(optimisticIndex);
    }
  }

  return consumedIndexes.size === 0
    ? (messages as T[])
    : messages.filter((_, index) => !consumedIndexes.has(index));
}

/**
 * Promote exactly the local projection admitted by the matching request. The
 * canonical ID prevents a later userCreated/history event from creating a
 * duplicate, while a late acknowledgement safely becomes a no-op.
 */
export function acknowledgeActestraOptimisticUserMessage<T extends UserMessageLike>(
  messages: readonly T[],
  optimisticMessageId: string,
  canonicalMessageId: string,
): T[] {
  const index = messages.findIndex(
    (message) => message.msg_id === optimisticMessageId && isActestraOptimisticUserMessage(message),
  );
  if (index === -1) {
    return messages as T[];
  }

  if (
    messages.some(
      (message, messageIndex) =>
        messageIndex !== index &&
        message.msg_id === canonicalMessageId &&
        !isActestraOptimisticUserMessage(message),
    )
  ) {
    return messages.filter((_, messageIndex) => messageIndex !== index);
  }

  const next = [...messages];
  next[index] = {
    ...messages[index],
    id: canonicalMessageId,
    msg_id: canonicalMessageId,
    status: "finish",
  } as T;
  return next;
}
