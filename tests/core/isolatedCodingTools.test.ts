import { describe, expect, it } from "vitest";
import * as core from "../../apps/desktop/src/core";

interface ExpectedCodingToolDefinition {
  readonly action: string;
  readonly resourceKind: string;
  readonly timeoutMs: number;
  readonly toolId: string;
}

interface ExpectedCodingToolCore {
  readonly CODING_DIFF_TOOL_ID: string;
  readonly CODING_FILE_READ_TOOL_ID: string;
  readonly CODING_FILE_WRITE_TOOL_ID: string;
  readonly CODING_GIT_TOOL_ID: string;
  readonly CODING_TERMINAL_TOOL_ID: string;
  readonly CODING_TEST_TOOL_ID: string;
  readonly CODING_TOOL_IDS: readonly string[];
  codingToolDefinition(toolId: string): ExpectedCodingToolDefinition;
  parseCodingToolInput(toolId: string, serialized: string): unknown;
}

const codingCore = core as typeof core & ExpectedCodingToolCore;

describe("P5.2 isolated coding tool contract", () => {
  it("declares only the closed file, terminal, Git, diff, and test capability set", () => {
    expect(codingCore.CODING_TOOL_IDS).toEqual([
      "actestra.coding.file.read-text",
      "actestra.coding.file.write-text",
      "actestra.coding.terminal.run",
      "actestra.coding.git.inspect",
      "actestra.coding.diff.inspect",
      "actestra.coding.test.run",
    ]);
    expect(codingCore.CODING_TOOL_IDS.map(codingCore.codingToolDefinition)).toEqual([
      {
        action: "workspace.read",
        resourceKind: "repository",
        timeoutMs: 5_000,
        toolId: "actestra.coding.file.read-text",
      },
      {
        action: "workspace.modify",
        resourceKind: "repository",
        timeoutMs: 5_000,
        toolId: "actestra.coding.file.write-text",
      },
      {
        action: "shell.execute",
        resourceKind: "repository",
        timeoutMs: 30_000,
        toolId: "actestra.coding.terminal.run",
      },
      {
        action: "tool.invoke",
        resourceKind: "repository",
        timeoutMs: 5_000,
        toolId: "actestra.coding.git.inspect",
      },
      {
        action: "workspace.read",
        resourceKind: "repository",
        timeoutMs: 5_000,
        toolId: "actestra.coding.diff.inspect",
      },
      {
        action: "shell.execute",
        resourceKind: "repository",
        timeoutMs: 60_000,
        toolId: "actestra.coding.test.run",
      },
    ]);
  });

  it("accepts only typed bounded inputs and never accepts a raw command or Git argument", () => {
    expect(
      codingCore.parseCodingToolInput(
        codingCore.CODING_FILE_READ_TOOL_ID,
        JSON.stringify({ contractVersion: 1, relativePath: "src/main.ts" }),
      ),
    ).toEqual({ contractVersion: 1, relativePath: "src/main.ts" });
    expect(
      codingCore.parseCodingToolInput(
        codingCore.CODING_GIT_TOOL_ID,
        JSON.stringify({ contractVersion: 1, query: "status" }),
      ),
    ).toEqual({ contractVersion: 1, query: "status" });

    expect(() =>
      codingCore.parseCodingToolInput(
        codingCore.CODING_TERMINAL_TOOL_ID,
        JSON.stringify({ contractVersion: 1, command: "rm -rf /" }),
      ),
    ).toThrowError(/unsupported field|commandId/);
    expect(() =>
      codingCore.parseCodingToolInput(
        codingCore.CODING_GIT_TOOL_ID,
        JSON.stringify({ contractVersion: 1, query: "status", args: ["--exec-path"] }),
      ),
    ).toThrowError(/unsupported field/);
    expect(() =>
      codingCore.parseCodingToolInput(
        codingCore.CODING_FILE_READ_TOOL_ID,
        JSON.stringify({ contractVersion: 1, relativePath: ".git/config" }),
      ),
    ).toThrowError(/Git administration/);
    expect(() =>
      codingCore.parseCodingToolInput(
        codingCore.CODING_FILE_WRITE_TOOL_ID,
        JSON.stringify({ contractVersion: 1, relativePath: "../escape", content: "blocked" }),
      ),
    ).toThrowError(/relative path/);
    expect(() =>
      codingCore.parseCodingToolInput(
        codingCore.CODING_FILE_WRITE_TOOL_ID,
        JSON.stringify({
          contractVersion: 1,
          relativePath: "large.txt",
          content: "x".repeat(65_537),
        }),
      ),
    ).toThrowError(/65536 bytes/);
  });

  it("rejects inherited object properties as undeclared tool identifiers", () => {
    for (const inheritedProperty of ["constructor", "__proto__", "toString"]) {
      expect(() => codingCore.codingToolDefinition(inheritedProperty)).toThrowError(
        expect.objectContaining({
          name: "IsolatedCodingToolContractError",
          code: "unsupported-tool",
        }),
      );
    }
  });
});
