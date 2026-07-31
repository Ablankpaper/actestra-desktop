import { realpath } from "node:fs/promises";
import { isAbsolute, parse } from "node:path";
import { assertAionUiNativeConversationId } from "../../compatibility/aionui";

const MAX_NATIVE_WORKSPACE_PATH_BYTES = 8 * 1_024;
const MAX_NATIVE_WORKSPACE_NAME_BYTES = 512;
const MAX_CANONICAL_WORKSPACE_NAME_BYTES = 128;

type AionUiGeneralWorkRealpath = (rootPath: string) => Promise<string>;

const systemRealpath: AionUiGeneralWorkRealpath = async (rootPath) => realpath(rootPath);

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

function boundedPresentationText(value: string, maximumBytes: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  let result = "";
  let resultBytes = 0;
  for (const character of normalized) {
    const characterBytes = byteLength(character);
    if (resultBytes + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    resultBytes += characterBytes;
  }
  return result;
}

export async function canonicalizeAionUiGeneralWorkNativeContext(
  context: AionUiGeneralWorkNativeContext,
  resolveRealpath: AionUiGeneralWorkRealpath = systemRealpath,
): Promise<AionUiGeneralWorkNativeContext> {
  if (
    typeof context.rootPath !== "string" ||
    context.rootPath.trim() !== context.rootPath ||
    context.rootPath.length === 0 ||
    byteLength(context.rootPath) > MAX_NATIVE_WORKSPACE_PATH_BYTES ||
    hasControlCharacter(context.rootPath) ||
    !isAbsolute(context.rootPath)
  ) {
    throw new Error("AionUI conversation has no bounded workspace root");
  }
  if (typeof context.displayName !== "string" || hasControlCharacter(context.displayName)) {
    throw new Error("AionUI conversation has no bounded workspace name");
  }
  const displayName = boundedPresentationText(
    context.displayName,
    MAX_CANONICAL_WORKSPACE_NAME_BYTES,
  );
  if (displayName.length === 0) {
    throw new Error("AionUI conversation has no bounded workspace name");
  }
  let rootPath: string;
  try {
    rootPath = await resolveRealpath(context.rootPath);
  } catch (error) {
    throw new Error("AionUI conversation workspace could not be resolved", { cause: error });
  }
  if (
    rootPath.trim() !== rootPath ||
    rootPath.length === 0 ||
    byteLength(rootPath) > MAX_NATIVE_WORKSPACE_PATH_BYTES ||
    hasControlCharacter(rootPath) ||
    !isAbsolute(rootPath)
  ) {
    throw new Error("AionUI conversation workspace canonical root is invalid");
  }
  if (rootPath === parse(rootPath).root) {
    throw new Error("AionUI conversation workspace root must not be the filesystem root");
  }
  return Object.freeze({
    rootPath,
    displayName,
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
  constructor(
    private readonly reader: AionUiGeneralWorkNativeConversationReader,
    private readonly resolveRealpath: AionUiGeneralWorkRealpath = systemRealpath,
  ) {}

  async resolve(nativeConversationId: string): Promise<AionUiGeneralWorkNativeContext> {
    assertAionUiNativeConversationId(nativeConversationId);
    return canonicalizeAionUiGeneralWorkNativeContext(
      parseNativeConversationContext(
        await this.reader.read(nativeConversationId),
        nativeConversationId,
      ),
      this.resolveRealpath,
    );
  }
}
