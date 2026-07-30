import { describe, expect, it } from "vitest";
import {
  MAX_WORKLOAD_CONTENT_BYTES,
  ScopedNativeToolContractError,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  assertPortableRelativePath,
  parseScopedNativeToolInput,
  scopedNativeToolDefinition,
  serializeScopedNativeToolInput,
} from "../../apps/desktop/src/core";

describe("GW-P4.4 scoped native tool contracts", () => {
  it("registers exactly the workspace-read and task-output-write definitions", () => {
    expect(scopedNativeToolDefinition(WORKSPACE_READ_TEXT_TOOL_ID)).toEqual({
      toolId: WORKSPACE_READ_TEXT_TOOL_ID,
      action: "workspace.read",
      resourceKind: "workspace",
      timeoutMs: 5_000,
    });
    expect(scopedNativeToolDefinition(TASK_OUTPUT_WRITE_TEXT_TOOL_ID)).toEqual({
      toolId: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      action: "artifact.create",
      resourceKind: "task-output",
      timeoutMs: 5_000,
    });
    expect(() => scopedNativeToolDefinition("actestra.shell.execute")).toThrowError(
      expect.objectContaining({
        code: "unsupported-tool",
      }),
    );
  });

  it("accepts portable paths and rejects traversal, absolute, alias, and Windows escape forms", () => {
    expect(() => assertPortableRelativePath("notes/结果.md")).not.toThrow();
    for (const candidate of [
      "../secret.txt",
      "notes/../secret.txt",
      "/etc/passwd",
      "C:/Windows/system.ini",
      "\\\\server\\share",
      "notes\\secret.txt",
      "notes//report.txt",
      "notes/./report.txt",
      "notes/NUL.txt",
      "notes/trailing.",
      "notes/trailing ",
      "notes/e\u0301.txt",
      "notes/report?.txt",
      "notes/report*.txt",
      'notes/report".txt',
      "notes/report<.txt",
      "notes/report>.txt",
      "notes/report|.txt",
      "notes/\ud800.txt",
    ]) {
      expect(
        () => assertPortableRelativePath(candidate),
        `expected ${JSON.stringify(candidate)} to fail`,
      ).toThrowError(ScopedNativeToolContractError);
    }
  });

  it("round-trips exact read and write payloads and rejects unknown fields", () => {
    const read = {
      contractVersion: 1,
      relativePath: "notes/input.txt",
    } as const;
    const write = {
      contractVersion: 1,
      relativePath: "reports/result.md",
      mediaType: "text/markdown; charset=utf-8",
      content: "# Result\n\nVerified.",
    } as const;

    expect(
      parseScopedNativeToolInput(
        WORKSPACE_READ_TEXT_TOOL_ID,
        serializeScopedNativeToolInput(WORKSPACE_READ_TEXT_TOOL_ID, read),
      ),
    ).toEqual(read);
    expect(
      parseScopedNativeToolInput(
        TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
        serializeScopedNativeToolInput(TASK_OUTPUT_WRITE_TEXT_TOOL_ID, write),
      ),
    ).toEqual(write);
    expect(() =>
      parseScopedNativeToolInput(
        WORKSPACE_READ_TEXT_TOOL_ID,
        JSON.stringify({ ...read, recursive: true }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid-input",
      }),
    );
  });

  it("accepts only a bounded per-invocation workspace read limit", () => {
    const boundedRead = {
      contractVersion: 1,
      relativePath: "notes/input.txt",
      maximumBytes: 64 * 1024,
    } as const;

    expect(
      parseScopedNativeToolInput(
        WORKSPACE_READ_TEXT_TOOL_ID,
        serializeScopedNativeToolInput(WORKSPACE_READ_TEXT_TOOL_ID, boundedRead),
      ),
    ).toEqual(boundedRead);
    for (const maximumBytes of [0, 1.5, MAX_WORKLOAD_CONTENT_BYTES + 1]) {
      expect(() =>
        parseScopedNativeToolInput(
          WORKSPACE_READ_TEXT_TOOL_ID,
          JSON.stringify({
            contractVersion: 1,
            relativePath: "notes/input.txt",
            maximumBytes,
          }),
        ),
      ).toThrowError(/maximumBytes must be an integer from 1/u);
    }
  });

  it("rejects non-round-trippable and oversized write content", () => {
    expect(() =>
      serializeScopedNativeToolInput(TASK_OUTPUT_WRITE_TEXT_TOOL_ID, {
        contractVersion: 1,
        relativePath: "result.txt",
        mediaType: "text/plain; charset=utf-8",
        content: "\ud800",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid-input",
      }),
    );
    expect(() =>
      serializeScopedNativeToolInput(TASK_OUTPUT_WRITE_TEXT_TOOL_ID, {
        contractVersion: 1,
        relativePath: "result.txt",
        mediaType: "text/plain; charset=utf-8",
        content: "x".repeat(MAX_WORKLOAD_CONTENT_BYTES + 1),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "content-too-large",
      }),
    );
  });
});
