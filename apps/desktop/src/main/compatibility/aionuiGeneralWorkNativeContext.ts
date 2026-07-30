import { isAbsolute, parse } from "node:path";
import { assertAionUiNativeConversationId } from "../../compatibility/aionui";

const MAX_NATIVE_WORKSPACE_PATH_BYTES = 8 * 1_024;
const MAX_NATIVE_WORKSPACE_NAME_BYTES = 512;

export interface AionUiGeneralWorkNativeContext {
  readonly rootPath: string;
  readonly displayName: string;
}

export interface AionUiGeneralWorkNativeContextPort {
  resolve(nativeConversationId: string): Promise<AionUiGeneralWorkNativeContext>;
}

export interface AionUiGeneralWorkNativeConversationReader {
  read(nativeConversationId: string): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function parseNativeConversationContext(
  value: unknown,
  nativeConversationId: string,
): AionUiGeneralWorkNativeContext {
  if (
    !isRecord(value) ||
    value.id !== nativeConversationId ||
    typeof value.name !== "string" ||
    !isRecord(value.extra) ||
    typeof value.extra.workspace !== "string"
  ) {
    throw new Error("AionUI native conversation context is invalid");
  }
  const displayName = value.name.trim();
  const rootPath = value.extra.workspace;
  if (
    displayName.length === 0 ||
    byteLength(displayName) > MAX_NATIVE_WORKSPACE_NAME_BYTES ||
    hasControlCharacter(displayName) ||
    rootPath.length === 0 ||
    rootPath.trim() !== rootPath ||
    byteLength(rootPath) > MAX_NATIVE_WORKSPACE_PATH_BYTES ||
    hasControlCharacter(rootPath) ||
    !isAbsolute(rootPath) ||
    rootPath === parse(rootPath).root
  ) {
    throw new Error("AionUI native conversation context is invalid");
  }
  return Object.freeze({
    rootPath,
    displayName,
  });
}

export class AionUiGeneralWorkNativeContextResolver implements AionUiGeneralWorkNativeContextPort {
  constructor(private readonly reader: AionUiGeneralWorkNativeConversationReader) {}

  async resolve(nativeConversationId: string): Promise<AionUiGeneralWorkNativeContext> {
    assertAionUiNativeConversationId(nativeConversationId);
    return parseNativeConversationContext(
      await this.reader.read(nativeConversationId),
      nativeConversationId,
    );
  }
}
