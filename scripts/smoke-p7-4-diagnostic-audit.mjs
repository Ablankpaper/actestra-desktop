import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const marker = "ACTESTRA_P7_DIAGNOSTIC_AUDIT_RESULT ";
const timeoutMs = Number(process.env.ACTESTRA_P7_DIAGNOSTIC_AUDIT_TIMEOUT_MS ?? 60_000);
const maxOutputBytes = Number(
  process.env.ACTESTRA_P7_DIAGNOSTIC_AUDIT_MAX_OUTPUT_BYTES ?? 512 * 1024,
);
const appArgument = process.argv[2];
const resultKeys = Object.freeze([
  "chainVerified",
  "databaseSchemaVersion",
  "policyVersion",
  "prunedRecordCount",
  "redacted",
  "reportPrivate",
  "reportSchemaVersion",
  "retainedRecordCount",
  "unresolvedPreserved",
]);
const exclusions = Object.freeze([
  "credentials",
  "provider-configuration",
  "prompts-and-completions",
  "tool-arguments-and-results",
  "content-references-and-patches",
  "user-paths",
  "environment-values",
  "raw-logs",
  "raw-identifiers",
]);
const rawIdentifierSentinels = Object.freeze([
  "request-p7-diagnostic-terminal",
  "request-p7-diagnostic-unresolved",
  "request-p7-diagnostic-recent",
  "session-p7-diagnostic-attempt",
  "workspace-p7-diagnostic-private",
  "tool-output-p7-diagnostic-private",
]);

function fail(message) {
  console.error("P7.4 packaged diagnostic and audit smoke: evidence-incomplete: " + message);
  process.exitCode = 1;
}

function appExecutable(appPath) {
  const candidate =
    appPath ??
    path.join(
      repositoryRoot,
      ".actestra",
      "aionui-v2.1.41",
      "out",
      "mac-" + process.arch,
      "Actestra.app",
    );
  const executable = candidate.endsWith(".app")
    ? path.join(candidate, "Contents", "MacOS", "Actestra")
    : candidate;
  if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("packaged executable is missing");
  }
  return executable;
}

function createIsolation() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("P7.4 packaged acceptance requires macOS arm64");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p7-diagnostic-smoke-"));
  const isolation = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    report: path.join(root, "actestra-diagnostics.json"),
    evidence: path.join(root, "p7-diagnostic-acceptance.json"),
  };
  for (const directory of [isolation.userData, isolation.home, isolation.temp]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return isolation;
}

function sanitizedEnvironment(isolation) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      /(?:KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|PROXY)/iu.test(name) ||
      name === "ACTESTRA_HOME_DIR" ||
      name === "ACTESTRA_TEMP_DIR"
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    ACTESTRA_E2E_TEST: "1",
    ACTESTRA_E2E_ISOLATION_ROOT: isolation.root,
    ACTESTRA_USER_DATA_DIR: isolation.userData,
    ACTESTRA_E2E_HOME_DIR: isolation.home,
    ACTESTRA_E2E_TEMP_DIR: isolation.temp,
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE: "1",
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT: isolation.report,
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE: isolation.evidence,
    HOME: isolation.home,
    TMPDIR: isolation.temp,
  };
}

function processRows() {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) throw new Error("could not inspect packaged process residue");
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      command: match[3],
    }));
}

function descendantsOf(rootPid, rows) {
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.parentPid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  descendants.delete(rootPid);
  return descendants;
}

function collectOwnedProcesses(rootPid, isolation, observed) {
  const rows = processRows();
  for (const pid of descendantsOf(rootPid, rows)) observed.add(pid);
  for (const row of rows) {
    if (row.command.includes(isolation.root)) observed.add(row.pid);
  }
}

function killOwnedResidue(isolation, observed) {
  const rows = processRows();
  const owned = new Set(observed);
  for (const row of rows) {
    if (row.command.includes(isolation.root)) owned.add(row.pid);
  }
  for (const pid of owned) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // A process may exit between the scan and cleanup.
    }
  }
}

function assertNoResidue(isolation, observed) {
  const rows = processRows();
  const live = new Set(rows.map((row) => row.pid));
  if (
    [...observed].some((pid) => pid !== process.pid && live.has(pid)) ||
    rows.some((row) => row.pid !== process.pid && row.command.includes(isolation.root))
  ) {
    throw new Error("packaged diagnostic process residue remains");
  }
}

function privateRegularFile(filePath) {
  const state = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return (
    state !== undefined && state.isFile() && !state.isSymbolicLink() && (state.mode & 0o077) === 0
  );
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function exactResult(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    arraysEqual(Object.keys(value).sort(), resultKeys) &&
    value.databaseSchemaVersion === 23 &&
    value.reportSchemaVersion === 1 &&
    value.policyVersion === 1 &&
    value.prunedRecordCount === 2 &&
    value.retainedRecordCount === 2 &&
    value.unresolvedPreserved === true &&
    value.chainVerified === true &&
    value.reportPrivate === true &&
    value.redacted === true
  );
}

function validateResult(output) {
  if (/sk-[a-z0-9]{16,}|api[_-]?key|authorization\s*:/iu.test(output)) {
    throw new Error("packaged output contains a credential-shaped value");
  }
  const results = [];
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf(marker);
    if (index === -1) continue;
    let value;
    try {
      value = JSON.parse(line.slice(index + marker.length));
    } catch {
      throw new Error("diagnostic result marker is malformed");
    }
    if (!exactResult(value)) {
      throw new Error("diagnostic result is not a closed acceptance record");
    }
    results.push(value);
  }
  if (results.length !== 1) {
    throw new Error("expected exactly one packaged diagnostic result");
  }
  return results[0];
}

function validateEvidence(isolation, result) {
  if (!privateRegularFile(isolation.evidence)) {
    throw new Error("independent diagnostic evidence is missing or not private");
  }
  const contents = fs.readFileSync(isolation.evidence, "utf8");
  let evidence;
  try {
    evidence = JSON.parse(contents);
  } catch {
    throw new Error("independent diagnostic evidence is invalid");
  }
  if (!exactResult(evidence) || JSON.stringify(evidence) !== JSON.stringify(result)) {
    throw new Error("independent diagnostic evidence does not match the result");
  }
}

function validateReport(isolation) {
  if (!privateRegularFile(isolation.report)) {
    throw new Error("diagnostic report is missing or not private");
  }
  const contents = fs.readFileSync(isolation.report, "utf8");
  if (
    Buffer.byteLength(contents) > 2 * 1024 * 1024 ||
    contents.includes(isolation.root) ||
    rawIdentifierSentinels.some((value) => contents.includes(value)) ||
    /sk-[a-z0-9]{16,}|api[_-]?key|authorization\s*:/iu.test(contents)
  ) {
    throw new Error("diagnostic report contains forbidden or unbounded evidence");
  }
  let report;
  try {
    report = JSON.parse(contents);
  } catch {
    throw new Error("diagnostic report is not valid JSON");
  }
  const topKeys = [
    "app",
    "attempts",
    "audit",
    "exclusions",
    "generatedAt",
    "redaction",
    "schemaVersion",
  ];
  const retention = report?.audit?.retention;
  const events = report?.audit?.events;
  const attempts = report?.attempts?.records;
  if (
    typeof report !== "object" ||
    report === null ||
    Array.isArray(report) ||
    !arraysEqual(Object.keys(report).sort(), topKeys) ||
    report.schemaVersion !== 1 ||
    report.redaction !== "metadata-only" ||
    report.app?.name !== "Actestra" ||
    report.app?.environment !== "packaged" ||
    retention?.contractVersion !== 1 ||
    retention.policyVersion !== 1 ||
    retention.maxAgeDays !== 90 ||
    retention.maxRecordCount !== 100_000 ||
    retention.prunedRecordCount !== 2 ||
    retention.retainedRecordCount !== 2 ||
    retention.firstRetainedSequence !== 3 ||
    retention.lastSequence !== 4 ||
    !/^[a-f0-9]{64}$/u.test(retention.chainHeadSha256) ||
    report.audit.exportedRecordCount !== 2 ||
    report.audit.truncated !== false ||
    !Array.isArray(events) ||
    events.length !== 2 ||
    events[0]?.sequence !== 4 ||
    events[0]?.type !== "tool.completed" ||
    events[1]?.sequence !== 3 ||
    events[1]?.type !== "tool.started" ||
    events.some((event) => !/^request-[0-9]{4}$/u.test(event.requestAlias)) ||
    new Set(events.map((event) => event.requestAlias)).size !== 2 ||
    report.attempts.exportedRecordCount !== 1 ||
    report.attempts.truncated !== false ||
    !Array.isArray(attempts) ||
    attempts.length !== 1 ||
    !/^attempt-[0-9]{4}$/u.test(attempts[0]?.attemptAlias) ||
    !arraysEqual(report.exclusions, exclusions)
  ) {
    throw new Error("diagnostic report contract is incomplete");
  }
  return report;
}

function validateDatabase(isolation, report) {
  const databasePath = path.join(isolation.userData, "state", "actestra.sqlite3");
  if (!privateRegularFile(databasePath)) {
    throw new Error("schema-23 diagnostic database is missing or not private");
  }
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
  });
  try {
    const schemaVersion = database.prepare("PRAGMA user_version").get()?.user_version;
    const integrityCheck = database.prepare("PRAGMA integrity_check").get()?.integrity_check;
    const records = database
      .prepare("SELECT sequence, event_type FROM privileged_audit_records ORDER BY sequence")
      .all();
    const integrity = database
      .prepare(
        "SELECT sequence, previous_sha256, chain_sha256 " +
          "FROM privileged_audit_integrity ORDER BY sequence",
      )
      .all();
    const retention = database
      .prepare(
        "SELECT contract_version, policy_version, max_age_days, max_record_count, " +
          "pruned_record_count, anchor_sequence, anchor_sha256, last_sequence, " +
          "chain_head_sha256, last_maintained_at " +
          "FROM privileged_audit_retention_state WHERE singleton = 1",
      )
      .get();
    if (
      schemaVersion !== 23 ||
      integrityCheck !== "ok" ||
      records.length !== 2 ||
      records[0]?.sequence !== 3 ||
      records[0]?.event_type !== "tool.started" ||
      records[1]?.sequence !== 4 ||
      records[1]?.event_type !== "tool.completed" ||
      integrity.length !== 2 ||
      integrity[0]?.sequence !== 3 ||
      integrity[1]?.sequence !== 4 ||
      !/^[a-f0-9]{64}$/u.test(retention?.anchor_sha256) ||
      retention?.contract_version !== 1 ||
      retention.policy_version !== 1 ||
      retention.max_age_days !== 90 ||
      retention.max_record_count !== 100_000 ||
      retention.pruned_record_count !== 2 ||
      retention.anchor_sequence !== 2 ||
      retention.last_sequence !== 4 ||
      integrity[0].previous_sha256 !== retention.anchor_sha256 ||
      integrity[1].previous_sha256 !== integrity[0].chain_sha256 ||
      retention.chain_head_sha256 !== integrity[1].chain_sha256 ||
      retention.chain_head_sha256 !== report.audit.retention.chainHeadSha256
    ) {
      throw new Error("schema-23 retained audit chain evidence is incomplete");
    }
  } finally {
    database.close();
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1
  ) {
    throw new Error("diagnostic smoke bounds are invalid");
  }
  const executable = appExecutable(appArgument);
  const isolation = createIsolation();
  const child = spawn(executable, [], {
    cwd: repositoryRoot,
    env: sanitizedEnvironment(isolation),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observed = new Set([child.pid ?? -1]);
  const sampler = setInterval(() => {
    try {
      collectOwnedProcesses(child.pid ?? -1, isolation, observed);
    } catch {
      // The final process scan remains authoritative.
    }
  }, 50);
  let output = "";
  let overflow = false;
  const append = (chunk) => {
    output += chunk.toString();
    if (Buffer.byteLength(output) > maxOutputBytes) {
      overflow = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, signal: "SIGKILL" });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ error });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  clearInterval(sampler);
  try {
    collectOwnedProcesses(child.pid ?? -1, isolation, observed);
    if (overflow) throw new Error("app output exceeded the bounded evidence limit");
    if (outcome.error) throw outcome.error;
    if (outcome.code !== 0 || outcome.signal !== null) {
      throw new Error(
        "app exited before diagnostic acceptance: " +
          String(outcome.code) +
          "/" +
          String(outcome.signal),
      );
    }
    const result = validateResult(output);
    validateEvidence(isolation, result);
    const report = validateReport(isolation);
    validateDatabase(isolation, report);
    await delay(100);
    assertNoResidue(isolation, observed);
    console.info("P7.4 packaged diagnostic and audit smoke passed.");
  } finally {
    killOwnedResidue(isolation, observed);
    fs.rmSync(isolation.root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "unknown harness failure");
});
