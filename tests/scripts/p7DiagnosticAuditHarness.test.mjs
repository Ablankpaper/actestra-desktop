// @vitest-environment node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/smoke-p7-4-diagnostic-audit.mjs");

function fakeAppMain(options) {
  const fs = require("node:fs");
  const path = require("node:path");
  const { spawn } = require("node:child_process");
  const { DatabaseSync } = require("node:sqlite");
  const resultMarker = "ACTESTRA_P7_DIAGNOSTIC_AUDIT_RESULT ";
  const root = process.env.ACTESTRA_E2E_ISOLATION_ROOT;
  const userData = process.env.ACTESTRA_USER_DATA_DIR;
  const home = process.env.ACTESTRA_E2E_HOME_DIR;
  const temp = process.env.ACTESTRA_E2E_TEMP_DIR;
  const reportPath = process.env.ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT;
  const evidencePath = process.env.ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE;
  const contained = (candidate) => {
    const relative = root && candidate ? path.relative(root, candidate) : "..";
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative)
    );
  };
  if (
    process.env.ACTESTRA_E2E_TEST !== "1" ||
    process.env.ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE !== "1" ||
    ![userData, home, temp, reportPath, evidencePath].every(contained)
  ) {
    process.exit(41);
  }
  if (options.hang) {
    setInterval(() => undefined, 1_000);
    return;
  }
  if (options.exitCode) process.exit(options.exitCode);

  const anchor = "a".repeat(64);
  const chain3 = "b".repeat(64);
  const chain4 = "c".repeat(64);
  const schemaVersion = options.schemaVersion ?? 23;
  const prunedRecordCount = options.noPrune ? 0 : 2;
  const anchorSequence = options.noPrune ? 0 : 2;
  const stateRoot = path.join(userData, "state");
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const databasePath = path.join(stateRoot, "actestra.sqlite3");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA user_version = " + String(schemaVersion));
  database.exec(
    "CREATE TABLE privileged_audit_records (" +
      "sequence INTEGER PRIMARY KEY, record_id TEXT, event_type TEXT, record_json TEXT);" +
      "CREATE TABLE privileged_audit_integrity (" +
      "sequence INTEGER PRIMARY KEY, previous_sha256 TEXT, chain_sha256 TEXT);" +
      "CREATE TABLE privileged_audit_retention_state (" +
      "singleton INTEGER PRIMARY KEY, contract_version INTEGER, policy_version INTEGER, " +
      "max_age_days INTEGER, max_record_count INTEGER, pruned_record_count INTEGER, " +
      "anchor_sequence INTEGER, anchor_sha256 TEXT, last_sequence INTEGER, " +
      "chain_head_sha256 TEXT, last_maintained_at TEXT);",
  );
  const auditInsert = database.prepare(
    "INSERT INTO privileged_audit_records (sequence, record_id, event_type, record_json) VALUES (?, ?, ?, ?)",
  );
  auditInsert.run(
    3,
    "audit-p7-diagnostic-unresolved",
    options.dropUnresolved ? "tool.completed" : "tool.started",
    "{}",
  );
  auditInsert.run(4, "audit-p7-diagnostic-recent", "tool.completed", "{}");
  const integrityInsert = database.prepare(
    "INSERT INTO privileged_audit_integrity (sequence, previous_sha256, chain_sha256) VALUES (?, ?, ?)",
  );
  integrityInsert.run(3, anchor, chain3);
  integrityInsert.run(4, options.brokenChain ? "d".repeat(64) : chain3, chain4);
  database
    .prepare(
      "INSERT INTO privileged_audit_retention_state (" +
        "singleton, contract_version, policy_version, max_age_days, max_record_count, " +
        "pruned_record_count, anchor_sequence, anchor_sha256, last_sequence, " +
        "chain_head_sha256, last_maintained_at) VALUES (1, 1, 1, 90, 100000, ?, ?, ?, 4, ?, ?)",
    )
    .run(prunedRecordCount, anchorSequence, anchor, chain4, "2026-12-01T00:00:00.000Z");
  database.close();
  fs.chmodSync(databasePath, 0o600);

  const result = {
    databaseSchemaVersion: schemaVersion,
    reportSchemaVersion: 1,
    policyVersion: 1,
    prunedRecordCount,
    retainedRecordCount: 2,
    unresolvedPreserved: !options.dropUnresolved,
    chainVerified: !options.brokenChain,
    reportPrivate: options.reportMode !== 0o644,
    redacted: !options.leak,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: "2026-12-01T00:00:00.000Z",
    redaction: "metadata-only",
    app: {
      name: "Actestra",
      version: "0.1.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      environment: "packaged",
    },
    audit: {
      retention: {
        contractVersion: 1,
        policyVersion: 1,
        maxAgeDays: 90,
        maxRecordCount: 100000,
        retainedRecordCount: 2,
        prunedRecordCount,
        firstRetainedSequence: 3,
        lastSequence: 4,
        chainHeadSha256: chain4,
        lastMaintainedAt: "2026-12-01T00:00:00.000Z",
      },
      exportedRecordCount: 2,
      truncated: false,
      events: [
        {
          sequence: 4,
          occurredAt: "2026-11-30T00:00:00.000Z",
          requestAlias: "request-0001",
          type: "tool.completed",
          action: "workspace.read",
          resourceKind: "workspace",
          outcomeCode: null,
          mayHaveExecuted: true,
        },
        {
          sequence: 3,
          occurredAt: "2026-07-01T00:00:02.000Z",
          requestAlias: options.leak ? "request-p7-diagnostic-unresolved" : "request-0002",
          type: options.dropUnresolved ? "tool.completed" : "tool.started",
          action: "workspace.read",
          resourceKind: "workspace",
          outcomeCode: null,
          mayHaveExecuted: options.dropUnresolved ? true : null,
        },
      ],
    },
    attempts: {
      exportedRecordCount: 1,
      truncated: false,
      records: [
        {
          attemptAlias: "attempt-0001",
          state: "failed",
          taskState: "failed",
          startedAt: "2026-11-30T00:00:00.000Z",
          lastSignalAt: "2026-11-30T00:01:00.000Z",
          restartCount: 0,
          forcedCancellation: false,
          incidentCode: "workspace-unavailable",
        },
      ],
    },
    exclusions: [
      "credentials",
      "provider-configuration",
      "prompts-and-completions",
      "tool-arguments-and-results",
      "content-references-and-patches",
      "user-paths",
      "environment-values",
      "raw-logs",
      "raw-identifiers",
    ],
  };
  fs.writeFileSync(reportPath, JSON.stringify(report), {
    mode: options.reportMode ?? 0o600,
  });
  if (!options.noEvidence) {
    fs.writeFileSync(evidencePath, JSON.stringify(result), { mode: 0o600 });
  }
  console.log(resultMarker + JSON.stringify(result));
  if (options.residual) {
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", root], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  process.exit(0);
}

function fakeApp(options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-diagnostic-harness-"));
  const app = path.join(directory, "Actestra");
  const source =
    "#!/usr/bin/env node\n(" + fakeAppMain.toString() + ")(" + JSON.stringify(options) + ");\n";
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
      ACTESTRA_P7_DIAGNOSTIC_AUDIT_TIMEOUT_MS: "2000",
      ACTESTRA_P7_DIAGNOSTIC_AUDIT_MAX_OUTPUT_BYTES: "16384",
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

describe("P7.4 packaged diagnostic and audit harness", () => {
  it("accepts exact private, redacted schema-23 chain and retention evidence", () => {
    withApp({}, (outcome) => {
      expect(outcome.status, outcome.stderr).toBe(0);
      expect(outcome.stdout).toContain("P7.4 packaged diagnostic and audit smoke passed");
    });
  });

  it("fails when the packaged app is missing", () => {
    const outcome = run(path.join(os.tmpdir(), "missing-p7-diagnostic-app"));
    expect(outcome.status).not.toBe(0);
    expect(outcome.stderr).toContain("packaged executable is missing");
  });

  it.each([
    ["nonzero app exit", { exitCode: 7 }],
    ["timeout", { hang: true }],
    ["public report mode", { reportMode: 0o644 }],
    ["wrong schema", { schemaVersion: 22 }],
    ["broken retained chain", { brokenChain: true }],
    ["missing terminal pruning", { noPrune: true }],
    ["lost unresolved evidence", { dropUnresolved: true }],
    ["raw identifier disclosure", { leak: true }],
    ["missing independent evidence", { noEvidence: true }],
    ["residual packaged descendant", { residual: true }],
  ])(
    "fails closed for %s",
    (_label, options) => {
      withApp(options, (outcome) => {
        expect(outcome.status).not.toBe(0);
        expect(outcome.stderr).toContain("evidence-incomplete");
      });
    },
    15_000,
  );
});
