import {
  toolId,
  type ProtectedAction,
  type ProtectedResourceKind,
  type ToolId,
} from "./privilegedServices";
import { assertPortableRelativePath } from "./scopedNativeTools";

export const ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION = 1 as const;
export const MAX_ISOLATED_CODING_TEXT_BYTES = 65_536;

export const CODING_FILE_READ_TOOL_ID = toolId("actestra.coding.file.read-text");
export const CODING_FILE_WRITE_TOOL_ID = toolId("actestra.coding.file.write-text");
export const CODING_TERMINAL_TOOL_ID = toolId("actestra.coding.terminal.run");
export const CODING_GIT_TOOL_ID = toolId("actestra.coding.git.inspect");
export const CODING_DIFF_TOOL_ID = toolId("actestra.coding.diff.inspect");
export const CODING_TEST_TOOL_ID = toolId("actestra.coding.test.run");

export const CODING_TOOL_IDS = Object.freeze([
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_DIFF_TOOL_ID,
  CODING_TEST_TOOL_ID,
] as const);

export type IsolatedCodingToolId = (typeof CODING_TOOL_IDS)[number];
export type IsolatedCodingGitQuery = "status" | "head";

export interface IsolatedCodingToolDefinition {
  readonly toolId: IsolatedCodingToolId;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
  readonly timeoutMs: number;
}

export interface CodingFileReadInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
  readonly relativePath: string;
  readonly maximumBytes?: number;
}

export interface CodingFileWriteInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
  readonly relativePath: string;
  readonly content: string;
}

export interface CodingTerminalInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
  readonly commandId: string;
}

export interface CodingGitInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
  readonly query: IsolatedCodingGitQuery;
}

export interface CodingDiffInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
}

export interface CodingTestInput {
  readonly contractVersion: typeof ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION;
  readonly testId: string;
}

export type IsolatedCodingToolInput =
  | CodingFileReadInput
  | CodingFileWriteInput
  | CodingTerminalInput
  | CodingGitInput
  | CodingDiffInput
  | CodingTestInput;

export type IsolatedCodingToolContractErrorCode = "invalid-input" | "unsupported-tool";

export class IsolatedCodingToolContractError extends Error {
  constructor(
    readonly code: IsolatedCodingToolContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IsolatedCodingToolContractError";
  }
}

const DEFINITIONS: Readonly<Record<string, IsolatedCodingToolDefinition>> = Object.freeze({
  [CODING_FILE_READ_TOOL_ID]: Object.freeze({
    toolId: CODING_FILE_READ_TOOL_ID,
    action: "workspace.read",
    resourceKind: "repository",
    timeoutMs: 5_000,
  }),
  [CODING_FILE_WRITE_TOOL_ID]: Object.freeze({
    toolId: CODING_FILE_WRITE_TOOL_ID,
    action: "workspace.modify",
    resourceKind: "repository",
    timeoutMs: 5_000,
  }),
  [CODING_TERMINAL_TOOL_ID]: Object.freeze({
    toolId: CODING_TERMINAL_TOOL_ID,
    action: "shell.execute",
    resourceKind: "repository",
    timeoutMs: 30_000,
  }),
  [CODING_GIT_TOOL_ID]: Object.freeze({
    toolId: CODING_GIT_TOOL_ID,
    action: "tool.invoke",
    resourceKind: "repository",
    timeoutMs: 5_000,
  }),
  [CODING_DIFF_TOOL_ID]: Object.freeze({
    toolId: CODING_DIFF_TOOL_ID,
    action: "workspace.read",
    resourceKind: "repository",
    timeoutMs: 5_000,
  }),
  [CODING_TEST_TOOL_ID]: Object.freeze({
    toolId: CODING_TEST_TOOL_ID,
    action: "shell.execute",
    resourceKind: "repository",
    timeoutMs: 60_000,
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported !== undefined) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      `Coding tool input contains unsupported field ${unsupported}`,
    );
  }
}

function assertContractVersion(value: unknown): void {
  if (value !== ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      `Coding tool input requires contract version ${ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION}`,
    );
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertRepositoryRelativePath(value: unknown): asserts value is string {
  try {
    assertPortableRelativePath(value);
  } catch (error) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      "Coding file input requires a normalized portable relative path",
      { cause: error },
    );
  }
  if (value.split("/").some((segment) => segment.toLowerCase() === ".git")) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      "Coding file input cannot address Git administration paths",
    );
  }
}

function assertBoundedText(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    hasUnpairedSurrogate(value) ||
    new TextEncoder().encode(value).byteLength > MAX_ISOLATED_CODING_TEXT_BYTES
  ) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      `Coding file content must be valid UTF-8 text of at most ${MAX_ISOLATED_CODING_TEXT_BYTES} bytes`,
    );
  }
}

function assertRegistryIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)
  ) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      `${label} must name one declared Actestra registry entry`,
    );
  }
}

export function codingToolDefinition(value: string | ToolId): IsolatedCodingToolDefinition {
  const definition = Object.hasOwn(DEFINITIONS, value) ? DEFINITIONS[value] : undefined;
  if (definition === undefined) {
    throw new IsolatedCodingToolContractError(
      "unsupported-tool",
      "Only declared isolated coding tools are registered",
    );
  }
  return definition;
}

export function parseCodingToolInput(
  tool: string | ToolId,
  serialized: string,
): IsolatedCodingToolInput {
  const definition = codingToolDefinition(tool);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      "Coding tool input must be valid JSON",
      { cause: error },
    );
  }
  if (!isRecord(value)) {
    throw new IsolatedCodingToolContractError(
      "invalid-input",
      "Coding tool input must be an object",
    );
  }
  assertContractVersion(value.contractVersion);

  switch (definition.toolId) {
    case CODING_FILE_READ_TOOL_ID:
      assertExactKeys(value, [
        "contractVersion",
        "relativePath",
        ...(value.maximumBytes === undefined ? [] : ["maximumBytes"]),
      ]);
      assertRepositoryRelativePath(value.relativePath);
      if (
        value.maximumBytes !== undefined &&
        (!Number.isSafeInteger(value.maximumBytes) ||
          (value.maximumBytes as number) < 1 ||
          (value.maximumBytes as number) > MAX_ISOLATED_CODING_TEXT_BYTES)
      ) {
        throw new IsolatedCodingToolContractError(
          "invalid-input",
          `Coding file read maximumBytes must be between 1 and ${MAX_ISOLATED_CODING_TEXT_BYTES}`,
        );
      }
      return {
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        relativePath: value.relativePath,
        ...(value.maximumBytes === undefined ? {} : { maximumBytes: value.maximumBytes as number }),
      };
    case CODING_FILE_WRITE_TOOL_ID:
      assertExactKeys(value, ["contractVersion", "relativePath", "content"]);
      assertRepositoryRelativePath(value.relativePath);
      assertBoundedText(value.content);
      return {
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        relativePath: value.relativePath,
        content: value.content,
      };
    case CODING_TERMINAL_TOOL_ID:
      assertExactKeys(value, ["contractVersion", "commandId"]);
      assertRegistryIdentifier(value.commandId, "Coding terminal commandId");
      return {
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        commandId: value.commandId,
      };
    case CODING_GIT_TOOL_ID:
      assertExactKeys(value, ["contractVersion", "query"]);
      if (value.query !== "status" && value.query !== "head") {
        throw new IsolatedCodingToolContractError(
          "invalid-input",
          "Coding Git query must be status or head",
        );
      }
      return {
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        query: value.query,
      };
    case CODING_DIFF_TOOL_ID:
      assertExactKeys(value, ["contractVersion"]);
      return { contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION };
    case CODING_TEST_TOOL_ID:
      assertExactKeys(value, ["contractVersion", "testId"]);
      assertRegistryIdentifier(value.testId, "Coding test testId");
      return {
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        testId: value.testId,
      };
    default:
      throw new IsolatedCodingToolContractError(
        "unsupported-tool",
        "Only declared isolated coding tools are registered",
      );
  }
}
