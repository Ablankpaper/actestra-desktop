// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCargoAuditLockScan } from "../../scripts/cargo-audit-lock-scan.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function createFakeAudit(sequence) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-cargo-audit-"));
  temporaryDirectories.push(root);
  const executable = path.join(root, "cargo-audit");
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ attempt: 0, sequence }), { mode: 0o600 });
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.ACTESTRA_TEST_AUDIT_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const result = state.sequence[state.attempt];
state.attempt += 1;
fs.writeFileSync(statePath, JSON.stringify(state));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.code);
`,
    { mode: 0o700 },
  );
  return { executable, root, statePath };
}

function transportFailure() {
  return {
    code: 2,
    stdout: "",
    stderr:
      "error: couldn't fetch advisory database: git operation failed: An IO error occurred when talking to the server\n" +
      "Caused by:\n  -> error sending request for url (https://github.com/RustSec/advisory-db.git/info/refs?service=git-upload-pack)\n",
  };
}

function auditResult(code = 1) {
  return { code, stdout: '{"database":{"advisory-count":1}}\n', stderr: "" };
}

describe("bounded cargo-audit lock scan", () => {
  it("recovers from a bounded transient RustSec fetch failure", async () => {
    const fixture = createFakeAudit([transportFailure(), transportFailure(), auditResult()]);

    const result = await runCargoAuditLockScan(fixture.executable, ["audit", "--json"], {
      cwd: fixture.root,
      env: { ...process.env, ACTESTRA_TEST_AUDIT_STATE: fixture.statePath },
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({ code: 1, signal: null });
    expect(JSON.parse(fs.readFileSync(fixture.statePath, "utf8")).attempt).toBe(3);
  });

  it("does not retry a completed vulnerability scan", async () => {
    const fixture = createFakeAudit([auditResult(), transportFailure()]);

    const result = await runCargoAuditLockScan(fixture.executable, ["audit", "--json"], {
      cwd: fixture.root,
      env: { ...process.env, ACTESTRA_TEST_AUDIT_STATE: fixture.statePath },
      retryDelayMs: 0,
    });

    expect(result.code).toBe(1);
    expect(JSON.parse(fs.readFileSync(fixture.statePath, "utf8")).attempt).toBe(1);
  });

  it("fails closed after three transport failures", async () => {
    const fixture = createFakeAudit([transportFailure(), transportFailure(), transportFailure()]);

    const result = await runCargoAuditLockScan(fixture.executable, ["audit", "--json"], {
      cwd: fixture.root,
      env: { ...process.env, ACTESTRA_TEST_AUDIT_STATE: fixture.statePath },
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({ code: 2, signal: null });
    expect(result.stderr).toContain("couldn't fetch advisory database");
    expect(JSON.parse(fs.readFileSync(fixture.statePath, "utf8")).attempt).toBe(3);
  });
});
