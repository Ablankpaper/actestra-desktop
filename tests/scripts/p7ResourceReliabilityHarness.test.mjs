// @vitest-environment node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/smoke-p7-2-resource-reliability.mjs");
const cases = [
  ["P7-R-GENERAL-CPU-001", "general", "worker-resource-cpu-exceeded"],
  ["P7-R-GENERAL-MEMORY-001", "general", "worker-resource-memory-exceeded"],
  ["P7-R-GOOSE-OUTPUT-001", "goose", "worker-resource-output-exceeded"],
  ["P7-R-GOOSE-STORAGE-001", "goose", "worker-resource-storage-exceeded"],
  ["P7-R-GOOSE-FORK-001", "goose", "worker-process-tree-violated"],
];

function fakeApp({ results = cases, leak = false, evidence = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-resource-harness-"));
  const app = path.join(directory, "Actestra");
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.ACTESTRA_E2E_ISOLATION_ROOT;
const inputs = [
  process.env.ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE,
  process.env.ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE,
  process.env.ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE,
  process.env.ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT,
];
if (!root || inputs.some((value) => !value || path.relative(root, value).startsWith('..'))) process.exit(41);
if (inputs.slice(0, 3).some((value) => !fs.statSync(value, { throwIfNoEntry: false })?.isFile())) process.exit(42);
const rows = ${JSON.stringify(results)}.map(([id, workerKind, incidentCode]) => ({
  id, workerKind, incidentCode, outcome: 'failed-closed', terminalState: 'failed',
  cleanup: 'verified', redacted: true,
}));
for (const row of rows) console.log('ACTESTRA_P7_RESOURCE_RELIABILITY_RESULT ' + JSON.stringify(row));
${leak ? "console.log('sk-abcdefghijklmnop1234567890');" : ""}
${
  evidence
    ? `fs.writeFileSync(process.env.ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE, JSON.stringify({
  schemaVersion: 1,
  ids: rows.map((row) => row.id),
  incidentCodes: rows.map((row) => row.incidentCode),
  cleanup: rows.map((row) => row.cleanup),
  redacted: true,
}));`
    : ""
}
process.exit(0);
`;
  writeFileSync(app, source, { mode: 0o700 });
  chmodSync(app, 0o700);
  return { app, directory };
}

function run(app) {
  return spawnSync(process.execPath, [script, app], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      ACTESTRA_P7_RESOURCE_RELIABILITY_TIMEOUT_MS: "5000",
      ACTESTRA_P7_RESOURCE_RELIABILITY_MAX_OUTPUT_BYTES: "16384",
    },
  });
}

function withApp(options, assertion) {
  const fixture = fakeApp(options);
  try {
    assertion(run(fixture.app));
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
}

describe("P7.2 packaged resource reliability harness", () => {
  it("accepts only the complete redacted failed-closed evidence set", () => {
    withApp({}, (outcome) => {
      expect(outcome.status).toBe(0);
      expect(outcome.stdout).toContain("5 failed-closed redacted cases");
    });
  });

  it("fails a missing General or Goose result", () => {
    withApp({ results: cases.slice(1) }, (outcome) => {
      expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain("evidence-incomplete");
    });
  });

  it("fails output containing a credential-shaped value", () => {
    withApp({ leak: true }, (outcome) => {
      expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain("evidence-incomplete");
    });
  });

  it("fails without independent durable evidence", () => {
    withApp({ evidence: false }, (outcome) => {
      expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain("evidence-incomplete");
    });
  });
});
