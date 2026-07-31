import { MAX_WORKLOAD_CONTENT_BYTES } from "./workloadContent";
import {
  toolId,
  type ProtectedAction,
  type ProtectedResourceKind,
  type ToolId,
} from "./privilegedServices";
import {
  OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH,
  assertOfficeDocumentModel,
  type OfficeDocumentModel,
} from "./officeDocumentArtifact";

export const SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION = 1 as const;
export const MAX_SCOPED_NATIVE_RELATIVE_PATH_BYTES = 1_024;
const TASK_OUTPUT_TEXT_MEDIA_TYPES = [
  "text/plain; charset=utf-8",
  "text/markdown; charset=utf-8",
] as const;

export const WORKSPACE_READ_TEXT_TOOL_ID = toolId("actestra.workspace.read-text");
export const TASK_OUTPUT_WRITE_TEXT_TOOL_ID = toolId("actestra.task-output.write-text");
export const TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID = toolId(
  "actestra.task-output.write-office-document",
);

export const SCOPED_NATIVE_TOOL_IDS = Object.freeze([
  WORKSPACE_READ_TEXT_TOOL_ID,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
] as const);

export type ScopedNativeToolId = (typeof SCOPED_NATIVE_TOOL_IDS)[number];

export interface ScopedNativeToolDefinition {
  readonly toolId: ScopedNativeToolId;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
  readonly timeoutMs: number;
}

export interface WorkspaceReadTextInput {
  readonly contractVersion: typeof SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION;
  readonly relativePath: string;
  readonly maximumBytes?: number;
}

export interface TaskOutputWriteTextInput {
  readonly contractVersion: typeof SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION;
  readonly relativePath: string;
  readonly mediaType: (typeof TASK_OUTPUT_TEXT_MEDIA_TYPES)[number];
  readonly content: string;
}

export interface TaskOutputWriteOfficeDocumentInput {
  readonly contractVersion: typeof SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION;
  readonly relativePath: typeof OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH;
  readonly document: OfficeDocumentModel;
}

export type ScopedNativeToolInput =
  | WorkspaceReadTextInput
  | TaskOutputWriteTextInput
  | TaskOutputWriteOfficeDocumentInput;

export type ScopedNativeToolContractErrorCode =
  | "invalid-input"
  | "invalid-relative-path"
  | "content-too-large"
  | "unsupported-tool";

export class ScopedNativeToolContractError extends Error {
  constructor(
    readonly code: ScopedNativeToolContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScopedNativeToolContractError";
  }
}

const DEFINITIONS = Object.freeze({
  [WORKSPACE_READ_TEXT_TOOL_ID]: Object.freeze({
    toolId: WORKSPACE_READ_TEXT_TOOL_ID,
    action: "workspace.read",
    resourceKind: "workspace",
    timeoutMs: 5_000,
  }),
  [TASK_OUTPUT_WRITE_TEXT_TOOL_ID]: Object.freeze({
    toolId: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
    action: "artifact.create",
    resourceKind: "task-output",
    timeoutMs: 5_000,
  }),
  [TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID]: Object.freeze({
    toolId: TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
    action: "artifact.create",
    resourceKind: "task-output",
    timeoutMs: 5_000,
  }),
} satisfies Record<ScopedNativeToolId, ScopedNativeToolDefinition>);

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const WINDOWS_FORBIDDEN_CHARACTER = /[?*"<>|]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new ScopedNativeToolContractError(
      "invalid-input",
      `${label} must contain only ${expected.join(", ")}`,
    );
  }
}

function isRoundTrippableUtf8(value: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}

export function assertPortableRelativePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    WINDOWS_FORBIDDEN_CHARACTER.test(value) ||
    !isRoundTrippableUtf8(value) ||
    value.normalize("NFC") !== value ||
    new TextEncoder().encode(value).byteLength > MAX_SCOPED_NATIVE_RELATIVE_PATH_BYTES
  ) {
    throw new ScopedNativeToolContractError(
      "invalid-relative-path",
      "Native tool path must be a normalized portable relative path",
    );
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        WINDOWS_RESERVED_SEGMENT.test(segment) ||
        new TextEncoder().encode(segment).byteLength > 255 ||
        [...segment].some((character) => {
          const point = character.codePointAt(0);
          return point === undefined || point <= 31 || (point >= 127 && point <= 159);
        }),
    )
  ) {
    throw new ScopedNativeToolContractError(
      "invalid-relative-path",
      "Native tool path contains a forbidden segment",
    );
  }
}

export function scopedNativeToolDefinition(value: string | ToolId): ScopedNativeToolDefinition {
  const definition = (DEFINITIONS as Readonly<Record<string, ScopedNativeToolDefinition>>)[value];
  if (definition === undefined) {
    throw new ScopedNativeToolContractError(
      "unsupported-tool",
      "Only declared scoped native tools are registered",
    );
  }
  return definition;
}

export function parseScopedNativeToolInput(
  tool: typeof WORKSPACE_READ_TEXT_TOOL_ID,
  serialized: string,
): WorkspaceReadTextInput;
export function parseScopedNativeToolInput(
  tool: typeof TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  serialized: string,
): TaskOutputWriteTextInput;
export function parseScopedNativeToolInput(
  tool: typeof TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  serialized: string,
): TaskOutputWriteOfficeDocumentInput;
export function parseScopedNativeToolInput(
  tool: string | ToolId,
  serialized: string,
): ScopedNativeToolInput;
export function parseScopedNativeToolInput(
  tool: string | ToolId,
  serialized: string,
): ScopedNativeToolInput {
  const definition = scopedNativeToolDefinition(tool);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new ScopedNativeToolContractError(
      "invalid-input",
      "Native tool input must be valid JSON",
      { cause: error },
    );
  }
  if (!isRecord(value)) {
    throw new ScopedNativeToolContractError("invalid-input", "Native tool input must be an object");
  }

  if (definition.toolId === WORKSPACE_READ_TEXT_TOOL_ID) {
    assertExactKeys(
      value,
      [
        "contractVersion",
        "relativePath",
        ...(value.maximumBytes === undefined ? [] : ["maximumBytes"]),
      ],
      "Workspace read input",
    );
    if (value.contractVersion !== SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION) {
      throw new ScopedNativeToolContractError(
        "invalid-input",
        "Workspace read input contract version is unsupported",
      );
    }
    assertPortableRelativePath(value.relativePath);
    if (
      value.maximumBytes !== undefined &&
      (!Number.isSafeInteger(value.maximumBytes) ||
        (value.maximumBytes as number) < 1 ||
        (value.maximumBytes as number) > MAX_WORKLOAD_CONTENT_BYTES)
    ) {
      throw new ScopedNativeToolContractError(
        "invalid-input",
        `Workspace read input.maximumBytes must be an integer from 1 to ${MAX_WORKLOAD_CONTENT_BYTES}`,
      );
    }
    return Object.freeze({
      contractVersion: SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION,
      relativePath: value.relativePath,
      ...(value.maximumBytes === undefined ? {} : { maximumBytes: value.maximumBytes as number }),
    });
  }

  if (definition.toolId === TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID) {
    assertExactKeys(
      value,
      ["contractVersion", "relativePath", "document"],
      "Task output Office-document input",
    );
    if (
      value.contractVersion !== SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION ||
      value.relativePath !== OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH
    ) {
      throw new ScopedNativeToolContractError(
        "invalid-input",
        `Office-document input requires ${OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH}`,
      );
    }
    try {
      assertOfficeDocumentModel(value.document);
    } catch (error) {
      throw new ScopedNativeToolContractError(
        "invalid-input",
        "Office-document input model is invalid",
        { cause: error },
      );
    }
    return Object.freeze({
      contractVersion: SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION,
      relativePath: OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH,
      document: Object.freeze({
        ...value.document,
        sections: Object.freeze(
          value.document.sections.map((section) => Object.freeze({ ...section })),
        ),
      }),
    });
  }

  assertExactKeys(
    value,
    ["contractVersion", "relativePath", "mediaType", "content"],
    "Task output write input",
  );
  if (value.contractVersion !== SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION) {
    throw new ScopedNativeToolContractError(
      "invalid-input",
      "Task output write input contract version is unsupported",
    );
  }
  assertPortableRelativePath(value.relativePath);
  if (
    typeof value.mediaType !== "string" ||
    !TASK_OUTPUT_TEXT_MEDIA_TYPES.includes(
      value.mediaType as (typeof TASK_OUTPUT_TEXT_MEDIA_TYPES)[number],
    )
  ) {
    throw new ScopedNativeToolContractError(
      "invalid-input",
      "Task output write input mediaType is unsupported",
    );
  }
  if (typeof value.content !== "string" || !isRoundTrippableUtf8(value.content)) {
    throw new ScopedNativeToolContractError(
      "invalid-input",
      "Task output content must be round-trippable UTF-8 text",
    );
  }
  if (new TextEncoder().encode(value.content).byteLength > MAX_WORKLOAD_CONTENT_BYTES) {
    throw new ScopedNativeToolContractError(
      "content-too-large",
      `Task output content exceeds ${MAX_WORKLOAD_CONTENT_BYTES} bytes`,
    );
  }

  return Object.freeze({
    contractVersion: SCOPED_NATIVE_TOOL_INPUT_CONTRACT_VERSION,
    relativePath: value.relativePath,
    mediaType: value.mediaType as (typeof TASK_OUTPUT_TEXT_MEDIA_TYPES)[number],
    content: value.content,
  });
}

export function serializeScopedNativeToolInput(
  tool: string | ToolId,
  input: ScopedNativeToolInput,
): string {
  const serialized = JSON.stringify(input);
  parseScopedNativeToolInput(tool, serialized);
  if (new TextEncoder().encode(serialized).byteLength > MAX_WORKLOAD_CONTENT_BYTES) {
    throw new ScopedNativeToolContractError(
      "content-too-large",
      `Serialized native tool input exceeds ${MAX_WORKLOAD_CONTENT_BYTES} bytes`,
    );
  }
  return serialized;
}
