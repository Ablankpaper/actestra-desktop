// @vitest-environment node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyBoundTestReport } from "../../scripts/p7-abuse-report.mjs";
import { P7_ABUSE_CASES } from "../security/abuseCaseCatalog";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const fixtureCatalog = [
  Object.freeze({
    id: "P7-A-PROCESS-001",
    variants: Object.freeze([
      Object.freeze({
        id: "P7-V-PROCESS-001-BOUNDED-RESULT",
        testFile: "tests/security/processOutcome.test.ts",
        testName: "P7-A-PROCESS-001 P7-V-PROCESS-001-BOUNDED-RESULT",
      }),
      Object.freeze({
        id: "P7-V-PROCESS-001-OUTPUT-OVERFLOW",
        testFile: "tests/security/processOutcome.test.ts",
        testName: "P7-A-PROCESS-001 P7-V-PROCESS-001-OUTPUT-OVERFLOW",
      }),
    ]),
  }),
  Object.freeze({
    id: "P7-A-PROCESS-002",
    variants: Object.freeze([
      Object.freeze({
        id: "P7-V-PROCESS-002-PARENT-DEATH",
        testFile: "tests/security/processCleanup.test.ts",
        testName: "P7-A-PROCESS-002 P7-V-PROCESS-002-PARENT-DEATH",
      }),
    ]),
  }),
];

const [boundedResult, outputOverflow] = fixtureCatalog[0].variants;
const [parentDeath] = fixtureCatalog[1].variants;

function reportSuite(testFile, assertions, asFileUrl = false) {
  const absolute = path.resolve(repositoryRoot, testFile);
  return {
    name: asFileUrl ? pathToFileURL(absolute).href : absolute,
    assertionResults: assertions,
  };
}

function emptyClassification(overrides = {}) {
  return {
    missingVariantIds: [],
    nonPassingVariantIds: [],
    duplicateVariantIds: [],
    unboundVariantIds: [],
    unknownVariantCount: 0,
    ...overrides,
  };
}

function completeCatalogReport({ failedVariantId, missingVariantId } = {}) {
  const byFile = new Map();
  for (const abuseCase of P7_ABUSE_CASES) {
    for (const variant of abuseCase.variants) {
      if (variant.id === missingVariantId) continue;
      const assertions = byFile.get(variant.testFile) ?? [];
      assertions.push({
        title: variant.testName,
        status: variant.id === failedVariantId ? "failed" : "passed",
        failureMessages:
          variant.id === failedVariantId
            ? ["credential-canary-value at /Users/example/private/workspace"]
            : [],
      });
      byFile.set(variant.testFile, assertions);
    }
  }
  return {
    testResults: [...byFile].map(([testFile, assertionResults]) => ({
      name: path.resolve(repositoryRoot, testFile),
      assertionResults,
    })),
  };
}

function runAggregateWithFakeBunx(source) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-report-"));
  const fakeBunx = path.join(directory, "bunx");
  writeFileSync(fakeBunx, source, { mode: 0o700 });
  chmodSync(fakeBunx, 0o700);
  try {
    return spawnSync(process.execPath, ["scripts/run-p7-abuse-cases.mjs"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("P7 abuse report classification", () => {
  it("names one failed exact variant without retaining raw failure diagnostics", () => {
    const report = {
      testResults: [
        reportSuite(
          boundedResult.testFile,
          [
            { title: boundedResult.testName, status: "passed" },
            {
              title: outputOverflow.testName,
              status: "failed",
              failureMessages: ["credential-canary-value at /Users/example/private/workspace"],
            },
          ],
          true,
        ),
        reportSuite(parentDeath.testFile, [{ title: parentDeath.testName, status: "passed" }]),
      ],
    };

    const result = classifyBoundTestReport(fixtureCatalog, report, repositoryRoot);

    expect(result).toEqual(
      emptyClassification({ nonPassingVariantIds: ["P7-V-PROCESS-001-OUTPUT-OVERFLOW"] }),
    );
    expect(JSON.stringify(result)).not.toContain("credential-canary-value");
    expect(JSON.stringify(result)).not.toContain("/Users/example/private/workspace");
  });

  it("does not let one passing broad case title satisfy a multi-variant case", () => {
    const report = {
      testResults: [
        reportSuite(boundedResult.testFile, [
          { title: "P7-A-PROCESS-001 bounds Worker process outcomes", status: "passed" },
        ]),
        reportSuite(parentDeath.testFile, [{ title: parentDeath.testName, status: "passed" }]),
      ],
    };

    expect(classifyBoundTestReport(fixtureCatalog, report, repositoryRoot)).toEqual(
      emptyClassification({
        missingVariantIds: ["P7-V-PROCESS-001-BOUNDED-RESULT", "P7-V-PROCESS-001-OUTPUT-OVERFLOW"],
      }),
    );
  });

  it("rejects an exact title reported by the wrong normalized test file", () => {
    const report = {
      testResults: [
        reportSuite("tests/security/other.test.ts", [
          { title: boundedResult.testName, status: "passed" },
        ]),
        reportSuite(outputOverflow.testFile, [
          { title: outputOverflow.testName, status: "passed" },
        ]),
        reportSuite(parentDeath.testFile, [{ title: parentDeath.testName, status: "passed" }]),
      ],
    };

    expect(classifyBoundTestReport(fixtureCatalog, report, repositoryRoot)).toEqual(
      emptyClassification({ unboundVariantIds: ["P7-V-PROCESS-001-BOUNDED-RESULT"] }),
    );
  });

  it("rejects duplicate, unknown, skipped, pending, todo, and unsupported variants", () => {
    const statuses = ["skipped", "pending", "todo", "unsupported"];
    for (const status of statuses) {
      const report = {
        testResults: [
          reportSuite(boundedResult.testFile, [
            { title: boundedResult.testName, status: "passed" },
            { title: boundedResult.testName, status: "passed" },
            { title: outputOverflow.testName, status },
            {
              title: "P7-A-PROCESS-001 P7-V-PROCESS-001-NOT-DECLARED",
              status: "passed",
            },
          ]),
          reportSuite(parentDeath.testFile, [{ title: parentDeath.testName, status: "passed" }]),
        ],
      };

      expect(classifyBoundTestReport(fixtureCatalog, report, repositoryRoot)).toEqual(
        emptyClassification({
          nonPassingVariantIds: ["P7-V-PROCESS-001-OUTPUT-OVERFLOW"],
          duplicateVariantIds: ["P7-V-PROCESS-001-BOUNDED-RESULT"],
          unknownVariantCount: 1,
        }),
      );
    }
  });

  it("runner emits only one failed known variant ID when aggregate Vitest fails", () => {
    const failedVariantId = "P7-V-PROCESS-002-PARENT-DEATH";
    const failureCanary = "credential-canary-at-/Users/example/private/workspace";
    const report = completeCatalogReport({ failedVariantId });
    const result = runAggregateWithFakeBunx(`#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv.find((value) => value.startsWith("--outputFile="));
if (output === undefined) process.exit(0);
fs.writeFileSync(output.slice("--outputFile=".length), ${JSON.stringify(JSON.stringify(report))});
console.log(${JSON.stringify(failureCanary)});
console.error(${JSON.stringify(failureCanary)});
process.exit(1);
`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("test-harness-invalid");
    expect(result.stderr).toContain(failedVariantId);
    expect(result.stdout).not.toContain(failureCanary);
    expect(result.stderr).not.toContain(failureCanary);
  });

  it("runner names one missing known variant without forwarding unrelated assertions", () => {
    const missingVariantId = "P7-V-IPC-001-STALE-FRAME";
    const report = completeCatalogReport({ missingVariantId });
    const result = runAggregateWithFakeBunx(`#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv.find((value) => value.startsWith("--outputFile="));
if (output === undefined) process.exit(0);
fs.writeFileSync(output.slice("--outputFile=".length), ${JSON.stringify(JSON.stringify(report))});
console.error("private-unbound-diagnostic");
process.exit(1);
`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("test-harness-invalid");
    expect(result.stderr).toContain(missingVariantId);
    expect(result.stdout).not.toContain("private-unbound-diagnostic");
    expect(result.stderr).not.toContain("private-unbound-diagnostic");
  });

  it("runner rejects a report where only all 28 broad case titles pass", () => {
    const broadReport = {
      testResults: P7_ABUSE_CASES.map((abuseCase) => ({
        name: path.resolve(repositoryRoot, abuseCase.variants[0].testFile),
        assertionResults: [{ title: `${abuseCase.id} broad case title`, status: "passed" }],
      })),
    };
    const firstVariantId = P7_ABUSE_CASES[0].variants[0].id;
    const result = runAggregateWithFakeBunx(`#!/usr/bin/env node
const fs = require("node:fs");
const output = process.argv.find((value) => value.startsWith("--outputFile="));
if (output === undefined) process.exit(0);
fs.writeFileSync(output.slice("--outputFile=".length), ${JSON.stringify(
      JSON.stringify(broadReport),
    )});
process.exit(0);
`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("test-harness-invalid");
    expect(result.stderr).toContain(firstVariantId);
    expect(result.stdout).not.toContain("passed: 28");
  });

  it("runner extracts only a declared variant ID when Vitest writes no JSON report", () => {
    const failedCaseId = "P7-A-PROCESS-002";
    const failedVariantId = "P7-V-PROCESS-002-PARENT-DEATH";
    const failureCanary = "credential-canary-at-/Users/example/private/workspace";
    const result = runAggregateWithFakeBunx(`#!/usr/bin/env node
const isCatalog = process.argv.includes("tests/security/abuseCaseCatalog.test.ts");
if (isCatalog) process.exit(0);
console.error(${JSON.stringify(`${failedCaseId} ${failedVariantId}: ${failureCanary}`)});
process.exit(1);
`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(failedVariantId);
    expect(result.stderr).not.toContain(failureCanary);
    expect(result.stdout).not.toContain(failureCanary);
  });
});
