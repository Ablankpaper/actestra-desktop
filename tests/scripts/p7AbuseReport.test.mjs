// @vitest-environment node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyBoundTestReport } from "../../scripts/p7-abuse-report.mjs";
import { P7_ABUSE_CASES } from "../security/abuseCaseCatalog";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const catalog = [
  Object.freeze({ id: "P7-A-PROCESS-001", testName: "process result is bounded" }),
  Object.freeze({ id: "P7-A-PROCESS-002", testName: "process groups are removed" }),
];

describe("P7 abuse report classification", () => {
  it("reports failed catalog IDs without retaining raw failure diagnostics", () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            { title: "process result is bounded", status: "passed" },
            {
              title: "process groups are removed",
              status: "failed",
              failureMessages: ["credential-canary-value at /Users/example/private/workspace"],
            },
          ],
        },
      ],
    };

    const result = classifyBoundTestReport(catalog, report);

    expect(result).toEqual({
      missingCaseIds: [],
      failedCaseIds: ["P7-A-PROCESS-002"],
    });
    expect(JSON.stringify(result)).not.toContain("credential-canary-value");
    expect(JSON.stringify(result)).not.toContain("/Users/example/private/workspace");
  });

  it("reports missing catalog IDs without retaining unrelated assertions", () => {
    const report = {
      testResults: [
        {
          assertionResults: [
            { title: "process result is bounded", status: "passed" },
            {
              title: "unbound diagnostic",
              status: "failed",
              failureMessages: ["private-unbound-diagnostic"],
            },
          ],
        },
      ],
    };

    const result = classifyBoundTestReport(catalog, report);

    expect(result).toEqual({
      missingCaseIds: ["P7-A-PROCESS-002"],
      failedCaseIds: [],
    });
    expect(JSON.stringify(result)).not.toContain("private-unbound-diagnostic");
  });

  it("emits only the failed case ID when the aggregate Vitest process fails", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-report-test-"));
    const fakeBunx = path.join(directory, "bunx");
    const failedId = "P7-A-PROCESS-002";
    const failureCanary = "credential-canary-at-/Users/example/private/workspace";
    const assertions = P7_ABUSE_CASES.map((entry) => ({
      title: entry.testName,
      status: entry.id === failedId ? "failed" : "passed",
      failureMessages: entry.id === failedId ? [failureCanary] : [],
    }));
    writeFileSync(
      fakeBunx,
      `#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv.find((value) => value.startsWith("--outputFile="));
if (output === undefined) process.exit(0);
fs.writeFileSync(output.slice("--outputFile=".length), ${JSON.stringify(
        JSON.stringify({ testResults: [{ assertionResults: assertions }] }),
      )});
console.log(${JSON.stringify(failureCanary)});
console.error(${JSON.stringify(failureCanary)});
process.exit(1);
`,
      { mode: 0o700 },
    );
    chmodSync(fakeBunx, 0o700);

    try {
      const result = spawnSync(process.execPath, ["scripts/run-p7-abuse-cases.mjs"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "test-harness-invalid: catalog cases did not pass: P7-A-PROCESS-002",
      );
      expect(result.stdout).not.toContain(failureCanary);
      expect(result.stderr).not.toContain(failureCanary);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("emits a bound case ID when Vitest fails before writing its JSON report", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-report-missing-"));
    const fakeBunx = path.join(directory, "bunx");
    const failureCanary = "credential-canary-at-/Users/example/private/workspace";
    writeFileSync(
      fakeBunx,
      `#!/usr/bin/env node
const isCatalog = process.argv.includes("tests/security/abuseCaseCatalog.test.ts");
if (isCatalog) process.exit(0);
console.error(${JSON.stringify(
        `P7-A-PROCESS-002 terminates a real Goose runner when its supervisor dies: ${failureCanary}`,
      )});
process.exit(1);
`,
      { mode: 0o700 },
    );
    chmodSync(fakeBunx, 0o700);

    try {
      const result = spawnSync(process.execPath, ["scripts/run-p7-abuse-cases.mjs"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("P7-A-PROCESS-002");
      expect(result.stderr).not.toContain(failureCanary);
      expect(result.stdout).not.toContain(failureCanary);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
