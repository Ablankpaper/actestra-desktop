// @vitest-environment node

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/smoke-p7-security.mjs");
const packagedIds = ["P7-A-RENDERER-002"];

function fakeApp({
  results = packagedIds,
  exitCode = 0,
  secret = false,
  malformedMarker = false,
  outcome = "denied-safe",
  durableEvidence = true,
  mutateSentinel = false,
  mutateGit = false,
  spawnResidual = false,
  hang = false,
  outputBytes = 0,
  assertIsolation = true,
} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-harness-test-"));
  const app = path.join(dir, "Actestra");
  const resultLines = results
    .map((id) =>
      JSON.stringify(
        `ACTESTRA_P7_SECURITY_SMOKE_RESULT ${JSON.stringify({
          id,
          outcome,
          redacted: true,
          sideEffectCount: 0,
          durableEvidence,
          evidenceVersion: 1,
        })}`,
      ),
    )
    .map((line) => `console.log(${line});`)
    .join("\n");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
${
  assertIsolation
    ? `const isolationRoot = process.env.ACTESTRA_E2E_ISOLATION_ROOT;
for (const name of ["ACTESTRA_USER_DATA_DIR", "ACTESTRA_E2E_HOME_DIR", "ACTESTRA_E2E_TEMP_DIR", "HOME", "TMPDIR"]) {
  const value = process.env[name];
  if (!isolationRoot || !value || path.relative(isolationRoot, value).startsWith("..")) process.exit(41);
}`
    : ""
}
${secret ? "console.log('sk-abcdefghijklmnop1234567890');" : ""}
${malformedMarker ? "console.log('ACTESTRA_P7_SECURITY_SMOKE_RESULT {broken');" : resultLines}
${outputBytes > 0 ? `console.log("x".repeat(${outputBytes}));` : ""}
${mutateSentinel ? "fs.writeFileSync(process.env.ACTESTRA_P7_SECURITY_SMOKE_SENTINEL, 'changed');" : ""}
${mutateGit ? "fs.writeFileSync(path.join(process.env.ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE, 'tracked.txt'), 'changed');" : ""}
${
  durableEvidence
    ? `fs.writeFileSync(process.env.ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE, JSON.stringify({ schemaVersion: 1, ids: ${JSON.stringify(results)}, outcomes: ${JSON.stringify(results.map(() => outcome))}, redacted: true }));`
    : ""
}
${spawnResidual ? "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', process.env.ACTESTRA_E2E_ISOLATION_ROOT], { detached: true, stdio: 'ignore' }).unref();" : ""}
${hang ? "setInterval(() => {}, 1000);" : `process.exit(${exitCode});`}
`;
  writeFileSync(app, source, { mode: 0o700 });
  chmodSync(app, 0o700);
  return { dir, app };
}

function run(app, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-harness-run-"));
  const isolation = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    workspace: path.join(root, "workspace"),
    sentinel: path.join(root, "sentinel.txt"),
    evidence: path.join(root, "evidence.json"),
  };
  for (const directory of [
    isolation.userData,
    isolation.home,
    isolation.temp,
    isolation.workspace,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(isolation.sentinel, "stable");
  writeFileSync(path.join(isolation.workspace, "tracked.txt"), "stable");
  const environment = {
    ACTESTRA_E2E_TEST: "1",
    ACTESTRA_E2E_ISOLATION_ROOT: isolation.root,
    ACTESTRA_USER_DATA_DIR: isolation.userData,
    ACTESTRA_E2E_HOME_DIR: isolation.home,
    ACTESTRA_E2E_TEMP_DIR: isolation.temp,
    HOME: isolation.home,
    TMPDIR: isolation.temp,
    // Keep the packaged-process budget bounded while allowing the full test
    // suite's parallel startup load to schedule the tiny fixture reliably.
    ACTESTRA_P7_SECURITY_SMOKE_TIMEOUT_MS: "5000",
    ACTESTRA_P7_SECURITY_SMOKE_MAX_OUTPUT_BYTES: "8192",
    ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: isolation.sentinel,
    ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: isolation.workspace,
    ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: isolation.evidence,
  };
  const result = spawnSync(process.execPath, [script, app], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ...environment, ...overrides },
  });
  rmSync(root, { recursive: true, force: true });
  return result;
}

function withFixture(options, assertion) {
  const fixture = fakeApp(options);
  try {
    assertion(run(fixture.app));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

describe("packaged P7 security harness", () => {
  it("accepts only a complete redacted denied-safe catalog with independent evidence", () => {
    withFixture({}, (result) => {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("1 denied-safe");
    });
  });

  it("fails when the packaged app is missing", () => {
    const result = run(path.join(os.tmpdir(), "missing-actestra-p7-app"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("packaged executable is missing");
  });

  it.each([
    ["missing case", { results: packagedIds.slice(1) }],
    ["duplicate case", { results: [...packagedIds, packagedIds[0]] }],
    ["unknown case", { results: [...packagedIds.slice(1), "P7-A-UNKNOWN-999"] }],
    ["unsupported outcome", { outcome: "unsupported-platform" }],
    ["non-denied outcome", { outcome: "security-boundary-violated" }],
    ["early exit", { exitCode: 1 }],
    ["secret output", { secret: true }],
    ["malformed marker", { malformedMarker: true }],
    ["missing durable evidence", { durableEvidence: false }],
    ["protected sentinel mutation", { mutateSentinel: true }],
    ["Git workspace mutation", { mutateGit: true }],
    ["residual descendant", { spawnResidual: true }],
    ["output overflow", { outputBytes: 16_384 }],
    ["timeout", { hang: true }],
  ])(
    "fails closed for %s",
    (_label, options) => {
      withFixture(options, (result) => {
        expect(result.status).not.toBe(0);
      });
    },
    15_000,
  );
});
