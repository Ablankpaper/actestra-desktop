// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  classifyLinuxProcessGroupReadError,
  linuxProcessGroupIdFromStat,
  readLinuxProcessGroupIdResultFromStat,
} from "./gooseLinuxProcessDiagnostics";

describe("Linux process-group diagnostics", () => {
  it("reads the process-group field after a command name with ordinary characters", () => {
    expect(linuxProcessGroupIdFromStat("123 (actestra-goose-runner) S 1 4242 4343 0")).toBe(4242);
  });

  it("uses the final closing parenthesis when the command name contains a parenthesis", () => {
    expect(linuxProcessGroupIdFromStat("123 (runner)debug) R 1 12 34 0")).toBe(12);
  });

  it.each([
    "malformed process stat",
    "123 (runner) S 1",
    "123 (runner) S 1 0",
    "123 (runner) S 1 999999999999999999999999 0",
  ])("returns no group for a malformed or unsafe stat record: %s", (stat) => {
    expect(linuxProcessGroupIdFromStat(stat)).toBeUndefined();
  });

  it.each([
    ["123 (runner) S 1 12 34 0", { kind: "ok", processGroupId: 12 }],
    ["malformed process stat", { kind: "failure", reason: "malformed" }],
  ] as const)("returns a closed result for stat content: %s", (stat, expected) => {
    expect(readLinuxProcessGroupIdResultFromStat(stat)).toEqual(expected);
  });

  it.each([
    [{ code: "ENOENT" }, "missing"],
    [{ code: "EACCES" }, "inaccessible"],
    [{ code: "EPERM" }, "inaccessible"],
    [{ code: "EIO" }, "unavailable"],
    [new Error("raw path must not escape"), "unavailable"],
  ] as const)(
    "classifies process-stat read failures without raw details: %j",
    (error, expected) => {
      expect(classifyLinuxProcessGroupReadError(error)).toBe(expected);
    },
  );
});
