import { createHash } from "node:crypto";
import { assertAionUiNativeConversationId } from "./generalWorkJourney";
import { AIONUI_NATIVE_SOURCE_VERSION } from "./nativeObservations";

export function hashAionUiGeneralWorkConversation(conversationId: string): string {
  assertAionUiNativeConversationId(conversationId);
  return createHash("sha256")
    .update(`${AIONUI_NATIVE_SOURCE_VERSION}\u0000conversation\u0000${conversationId}`)
    .digest("hex");
}
