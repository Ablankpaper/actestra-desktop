// @vitest-environment node

import { describe, expect, it } from "vitest";
import { linuxProcessGroupIdFromStat } from "./gooseLinuxProcessDiagnostics";

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
});
