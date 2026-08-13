import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const marker = "ACTESTRA_P7_SECURITY_SMOKE_RESULT ";
const packagedCaseIds = ["P7-A-RENDERER-002"];
const timeoutMs = Number(process.env.ACTESTRA_P7_SECURITY_SMOKE_TIMEOUT_MS ?? 60_000);
const maxOutputBytes = Number(
  process.env.ACTESTRA_P7_SECURITY_SMOKE_MAX_OUTPUT_BYTES ?? 2 * 1024 * 1024,
);
const appArgument = process.argv[2];

function fail(message) {
  console.error(`P7 packaged security smoke: evidence-incomplete: ${message}`);
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
    ACTESTRA_P7_SECURITY_SMOKE: "1",
    ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: isolation.sentinel,
    ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: isolation.workspace,
    ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: isolation.evidence,
    ACTESTRA_P7_SECURITY_SMOKE_TARGET: isolation.target,
    HOME: isolation.home,
    TMPDIR: isolation.temp,
  };
}

function git(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`protected Git fixture setup failed: ${command}`);
}

function hostileListenerAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal && address.address !== "0.0.0.0") {
        return address.address;
      }
    }
  }
  throw new Error("packaged guest hostile listener requires a non-loopback IPv4 interface");
}

async function createIsolation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p7-security-smoke-"));
  const hostileAddress = hostileListenerAddress();
  const server = http.createServer((_request, response) => {
    isolation.hostileHits += 1;
    response.writeHead(200, { "Content-Length": "0" });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // Bind all local interfaces so the fixture does not require a loopback
    // alias (macOS commonly has only 127.0.0.1). The probe target remains the
    // concrete non-loopback address, which the guest policy must deny.
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("hostile listener failed to bind");
  const isolation = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    workspace: path.join(root, "workspace"),
    sentinel: path.join(root, "protected-sentinel.txt"),
    evidence: path.join(root, "p7-evidence.json"),
    target: `http://${hostileAddress}:${address.port}/p7-denied`,
    hostileHits: 0,
    server,
  };
  for (const directory of [
    isolation.userData,
    isolation.home,
    isolation.temp,
    isolation.workspace,
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(isolation.sentinel, "P7 protected sentinel\n", { mode: 0o600 });
  fs.writeFileSync(path.join(isolation.workspace, "tracked.txt"), "P7 protected Git file\n");
  git("git", ["init", "-q"], isolation.workspace);
  git("git", ["config", "user.email", "p7-smoke@example.invalid"], isolation.workspace);
  git("git", ["config", "user.name", "P7 Smoke"], isolation.workspace);
  git("git", ["add", "tracked.txt"], isolation.workspace);
  git("git", ["commit", "-qm", "P7 protected baseline"], isolation.workspace);
  return isolation;
}

function processRows() {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", timeout: 5_000 });
  if (result.status !== 0) throw new Error("could not inspect packaged process residue");
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
      // The process can exit between ps and kill; the final scan is authoritative.
    }
  }
}

function assertNoResidue(isolation, observedPids = []) {
  const residue = processRows().filter(
    (row) => row.pid !== process.pid && row.command.includes(isolation.root),
  );
  if (residue.length > 0) throw new Error("packaged process residue remains");
  const liveObserved = new Set(processRows().map((row) => row.pid));
  if (observedPids.some((pid) => liveObserved.has(pid))) {
    throw new Error("recorded packaged descendants remain");
  }
  const names = fs.readdirSync(isolation.root);
  if (names.some((name) => /(?:goose|aioncore|planner|worker)/iu.test(name))) {
    throw new Error("privileged runtime residue remains in isolated root");
  }
}

function assertHostileListenerUnused(isolation) {
  if (isolation.hostileHits !== 0) throw new Error("Renderer reached the hostile listener");
}

function assertProtectedState(isolation, sentinelBytes, head) {
  if (!Buffer.from(fs.readFileSync(isolation.sentinel)).equals(sentinelBytes)) {
    throw new Error("protected sentinel changed");
  }
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: isolation.workspace,
    encoding: "utf8",
  });
  const currentHead = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: isolation.workspace,
    encoding: "utf8",
  });
  if (status.status !== 0 || status.stdout.trim() !== "" || currentHead.stdout.trim() !== head) {
    throw new Error("protected Git state changed");
  }
}

function validateDurableEvidence(isolation) {
  const contents = fs.readFileSync(isolation.evidence, "utf8");
  const evidence = JSON.parse(contents);
  if (
    evidence?.schemaVersion !== 1 ||
    evidence.redacted !== true ||
    !Array.isArray(evidence.ids) ||
    evidence.ids.length !== packagedCaseIds.length ||
    evidence.ids.some((id) => !packagedCaseIds.includes(id))
  ) {
    throw new Error("durable security evidence is missing or invalid");
  }
  if (/sk-|api[_-]?key|authorization\s*:/iu.test(contents)) {
    throw new Error("durable security evidence contains protected values");
  }
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
      throw new Error("result marker is malformed");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.id !== "string" ||
      !packagedCaseIds.includes(value.id) ||
      value.outcome !== "denied-safe" ||
      value.redacted !== true ||
      value.evidenceVersion !== 1 ||
      !Number.isSafeInteger(value.sideEffectCount) ||
      value.sideEffectCount !== 0
    ) {
      throw new Error("result is not a valid denied-safe redacted record");
    }
    results.push(value);
  }
  const observed = new Set(results.map((result) => result.id));
  if (results.length !== packagedCaseIds.length || observed.size !== packagedCaseIds.length) {
    throw new Error(`expected exactly ${packagedCaseIds.length} unique packaged results`);
  }
  return results;
}

async function main() {
  if (packagedCaseIds.length !== 1 || new Set(packagedCaseIds).size !== 1) {
    throw new Error("packaged case set is not closed");
  }
  const executable = appExecutable(appArgument);
  const isolation = await createIsolation();
  const sentinelBytes = fs.readFileSync(isolation.sentinel);
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: isolation.workspace,
    encoding: "utf8",
  }).stdout.trim();
  const child = spawn(executable, [], {
    cwd: repositoryRoot,
    env: sanitizedEnvironment(isolation),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observedPids = [child.pid ?? -1];
  for (const row of processRows()) {
    if (row.pid !== child.pid && row.command.includes(isolation.root)) observedPids.push(row.pid);
  }
  let output = "";
  let overflow = false;
  const append = (chunk) => {
    output += chunk.toString();
    if (Buffer.byteLength(output) > maxOutputBytes) overflow = true;
    if (overflow) child.kill("SIGKILL");
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
      throw new Error(
        `app exited before acceptance: ${String(outcome.code)}/${String(outcome.signal)}`,
      );
    }
    validateResults(output);
    validateDurableEvidence(isolation);
    assertProtectedState(isolation, sentinelBytes, head);
    assertHostileListenerUnused(isolation);
    assertNoResidue(isolation, observedPids);
    console.info(
      `P7 packaged security smoke passed: ${packagedCaseIds.length} denied-safe redacted cases.`,
    );
  } finally {
    isolation.server.close();
    if (outcome.signal === "SIGKILL") {
      killOwnedResidue(isolation);
    }
    killOwnedResidue(isolation);
    fs.rmSync(isolation.root, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown harness failure"));
