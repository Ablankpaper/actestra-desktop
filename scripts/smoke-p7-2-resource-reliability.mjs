import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const marker = "ACTESTRA_P7_RESOURCE_RELIABILITY_RESULT ";
const cases = Object.freeze([
  Object.freeze({
    id: "P7-R-GENERAL-CPU-001",
    workerKind: "general",
    incidentCode: "worker-resource-cpu-exceeded",
  }),
  Object.freeze({
    id: "P7-R-GENERAL-MEMORY-001",
    workerKind: "general",
    incidentCode: "worker-resource-memory-exceeded",
  }),
  Object.freeze({
    id: "P7-R-GOOSE-OUTPUT-001",
    workerKind: "goose",
    incidentCode: "worker-resource-output-exceeded",
  }),
  Object.freeze({
    id: "P7-R-GOOSE-STORAGE-001",
    workerKind: "goose",
    incidentCode: "worker-resource-storage-exceeded",
  }),
  Object.freeze({
    id: "P7-R-GOOSE-FORK-001",
    workerKind: "goose",
    incidentCode: "worker-process-tree-violated",
  }),
]);
const timeoutMs = Number(process.env.ACTESTRA_P7_RESOURCE_RELIABILITY_TIMEOUT_MS ?? 75_000);
const maxOutputBytes = Number(
  process.env.ACTESTRA_P7_RESOURCE_RELIABILITY_MAX_OUTPUT_BYTES ?? 512 * 1024,
);
const appArgument = process.argv[2];

function fail(message) {
  console.error(`P7.2 packaged resource reliability smoke: evidence-incomplete: ${message}`);
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
      `mac-${process.arch}`,
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

function generalProbeSource(mode) {
  const workload =
    mode === "cpu"
      ? `function consumeCpu() {
  if (!running) return;
  const until = Date.now() + 20;
  let value = 1;
  while (Date.now() < until) value = Math.imul(value + 1, 2654435761);
  cpuSink = value;
  setImmediate(consumeCpu);
}`
      : `function consumeMemory() {
  if (!running) return;
  allocations.push(Buffer.alloc(16 * 1024 * 1024, 1));
  resourceTimer = setTimeout(consumeMemory, 35);
}`;
  const starter = mode === "cpu" ? "consumeCpu();" : "consumeMemory();";
  return `const parentPort = process.parentPort;
if (!parentPort) process.exit(40);
let attemptToken;
let sequence = 0;
let running = false;
let resourceTimer;
let cpuSink = 0;
const allocations = [];
function response(request) {
  parentPort.postMessage({ protocolVersion: 2, type: 'response', requestId: request.requestId,
    operation: request.operation, ok: true });
}
function event(value) {
  sequence += 1;
  parentPort.postMessage({ protocolVersion: 2, type: 'event', attemptToken, sequence, event: value });
}
${workload}
function stopWorkload() {
  running = false;
  if (resourceTimer) clearTimeout(resourceTimer);
}
parentPort.on('message', ({ data: request }) => {
  if (!request || request.protocolVersion !== 2 || request.type !== 'request') process.exit(41);
  if (request.operation === 'start') {
    attemptToken = request.payload.attemptToken;
    response(request);
    event({ type: 'started' });
    running = true;
    setTimeout(() => { ${starter} }, 250);
    return;
  }
  if (request.operation === 'cancel') {
    stopWorkload();
    response(request);
    event({ type: 'cancelled', reason: 'bounded probe cancellation' });
    return;
  }
  if (request.operation === 'dispose') {
    stopWorkload();
    response(request);
    return;
  }
  if (request.operation === 'close') {
    stopWorkload();
    response(request);
    setImmediate(() => process.exit(0));
    return;
  }
  response(request);
});
parentPort.postMessage({
  protocolVersion: 2,
  type: 'ready',
  role: 'general-worker',
  implementationVersion: '0.2.0',
  capabilities: ['messages', 'cancellation', 'heartbeats', 'tool-results', 'model-requests'],
  maxConcurrentAttempts: 1,
  heartbeatIntervalMs: 1000,
});
`;
}

function createIsolation() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("hostile probes require supported macOS arm64");
  }
  const parent = "/private/var/tmp";
  if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("hostile probe isolation parent is unavailable");
  }
  const root = fs.mkdtempSync(path.join(parent, "actestra-p7-resource-smoke-"));
  const isolation = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    goosePrivateRoot: path.join(root, "goose-private"),
    evidence: path.join(root, "resource-evidence.json"),
    generalCpuProbe: path.join(root, "general-cpu.cjs"),
    generalMemoryProbe: path.join(root, "general-memory.cjs"),
    gooseForkProbe: path.join(root, "goose-fork.pl"),
  };
  for (const directory of [
    isolation.userData,
    isolation.home,
    isolation.temp,
    isolation.goosePrivateRoot,
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(isolation.generalCpuProbe, generalProbeSource("cpu"), { mode: 0o600 });
  fs.writeFileSync(isolation.generalMemoryProbe, generalProbeSource("memory"), { mode: 0o600 });
  fs.writeFileSync(
    isolation.gooseForkProbe,
    `use strict; use warnings;
my ($result) = @ARGV;
my $child = fork();
if (!defined($child)) {
  open(my $fh, '>', $result) or exit 3;
  print $fh 'fork-denied';
  close($fh) or exit 3;
  exit 0;
}
exit 9;`,
    { mode: 0o600 },
  );
  return isolation;
}

function sanitizedEnvironment(isolation) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|PROXY)/iu.test(name)) {
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
    ACTESTRA_P7_RESOURCE_RELIABILITY_SMOKE: "1",
    ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE: isolation.evidence,
    ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE: isolation.generalCpuProbe,
    ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE: isolation.generalMemoryProbe,
    ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE: isolation.gooseForkProbe,
    ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT: isolation.goosePrivateRoot,
    HOME: isolation.home,
    TMPDIR: isolation.temp,
  };
}

function processRows() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) throw new Error("could not inspect resource probe process residue");
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => /^\s*(\d+)\s+(.+)$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number(match[1]), command: match[2] }));
}

function killOwnedResidue(isolation) {
  for (const row of processRows()) {
    if (row.pid === process.pid || !row.command.includes(isolation.root)) continue;
    try {
      process.kill(row.pid, "SIGKILL");
    } catch {
      // The process can exit between inspection and cleanup.
    }
  }
}

function assertNoResidue(isolation) {
  const residue = processRows().filter(
    (row) => row.pid !== process.pid && row.command.includes(isolation.root),
  );
  if (residue.length !== 0) throw new Error("resource probe process residue remains");
  if (fs.readdirSync(isolation.goosePrivateRoot).length !== 0) {
    throw new Error("Goose resource probe private-root residue remains");
  }
}

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateResults(output) {
  if (/sk-[a-z0-9]{16,}|api[_-]?key|authorization\s*:/iu.test(output)) {
    throw new Error("output contains a credential-shaped value");
  }
  const results = [];
  for (const line of output.split(/\r?\n/u)) {
    const index = line.indexOf(marker);
    if (index === -1) continue;
    let value;
    try {
      value = JSON.parse(line.slice(index + marker.length));
    } catch {
      throw new Error("resource result marker is malformed");
    }
    const expected = cases[results.length];
    const keys =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.keys(value).sort()
        : [];
    if (
      expected === undefined ||
      keys.join("\0") !==
        [
          "cleanup",
          "id",
          "incidentCode",
          "outcome",
          "redacted",
          "terminalState",
          "workerKind",
        ].join("\0") ||
      value.id !== expected.id ||
      value.workerKind !== expected.workerKind ||
      value.incidentCode !== expected.incidentCode ||
      value.outcome !== "failed-closed" ||
      value.terminalState !== "failed" ||
      value.cleanup !== "verified" ||
      value.redacted !== true
    ) {
      throw new Error("resource result is not a closed redacted record");
    }
    results.push(value);
  }
  if (results.length !== cases.length) {
    throw new Error(`expected exactly ${String(cases.length)} unique packaged resource results`);
  }
  return results;
}

function validateDurableEvidence(isolation, results) {
  const contents = fs.readFileSync(isolation.evidence, "utf8");
  let evidence;
  try {
    evidence = JSON.parse(contents);
  } catch {
    throw new Error("durable resource evidence is missing or invalid");
  }
  const keys =
    typeof evidence === "object" && evidence !== null && !Array.isArray(evidence)
      ? Object.keys(evidence).sort()
      : [];
  if (
    keys.join("\0") !==
      ["cleanup", "ids", "incidentCodes", "redacted", "schemaVersion"].join("\0") ||
    evidence.schemaVersion !== 1 ||
    evidence.redacted !== true ||
    !arraysEqual(
      evidence.ids,
      results.map((entry) => entry.id),
    ) ||
    !arraysEqual(
      evidence.incidentCodes,
      results.map((entry) => entry.incidentCode),
    ) ||
    !arraysEqual(
      evidence.cleanup,
      results.map((entry) => entry.cleanup),
    ) ||
    /sk-|api[_-]?key|authorization\s*:/iu.test(contents)
  ) {
    throw new Error("durable resource evidence is missing or invalid");
  }
}

async function main() {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1
  ) {
    throw new Error("resource smoke bounds are invalid");
  }
  const executable = appExecutable(appArgument);
  const isolation = createIsolation();
  const child = spawn(executable, [], {
    cwd: repositoryRoot,
    env: sanitizedEnvironment(isolation),
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  try {
    if (overflow) throw new Error("app output exceeded the bounded evidence limit");
    if (outcome.error) throw outcome.error;
    if (outcome.code !== 0 || outcome.signal !== null) {
      throw new Error("app exited before resource acceptance");
    }
    const results = validateResults(output);
    validateDurableEvidence(isolation, results);
    assertNoResidue(isolation);
    console.info(
      `P7.2 packaged resource reliability smoke passed: ${String(cases.length)} failed-closed redacted cases.`,
    );
  } finally {
    killOwnedResidue(isolation);
    fs.rmSync(isolation.root, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown harness failure"));
